/**
 * Authentication & RBAC Middleware
 *
 * authenticate:   Verifies JWT, attaches user to request
 * requireRole:    Enforces RBAC – rejects if user role not in allowed list
 * rateLimiter:    Per-IP rate limiting factory
 */
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import {
  verifyAccessToken,
  JwtPayload,
} from '../../../infrastructure/auth/jwt.service';
import { redis, CACHE_KEYS } from '../../../infrastructure/cache/redis.client';
import {
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
} from '../../../shared/errors';
import { logger } from '../../../shared/logger';

// Extend Express Request to carry the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the standard way to augment Express's own Request interface
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ── JWT Authentication ────────────────────────────────────────
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined;

    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      throw new UnauthorizedError('No access token provided');
    }

    const payload = verifyAccessToken(token);

    // Check revocation list in Redis — FAIL OPEN on a Redis outage. Access tokens
    // are short-lived and already cryptographically verified above; treating a
    // Redis blip as "every request is unauthenticated" would take the whole API
    // down (see redis.client.ts). We accept the token and log loudly instead.
    try {
      const isRevoked = await redis.get(CACHE_KEYS.tokenRevoked(payload.jti));
      if (isRevoked) {
        throw new UnauthorizedError('Token has been revoked');
      }
    } catch (redisErr) {
      if (redisErr instanceof UnauthorizedError) throw redisErr;
      logger.error({ err: redisErr, jti: payload.jti }, 'Redis unavailable during revocation check — failing OPEN');
    }

    req.user = payload;
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError());
  }
}

// ── Role-Based Access Control ────────────────────────────────
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`
        )
      );
    }
    next();
  };
}

// ── Rate Limiter Factory ─────────────────────────────────────
// Backed by Redis (not the in-memory default) so limits are enforced across
// every replica/process sharing this Redis instance instead of resetting per
// process — a multi-replica deployment with an in-memory store lets an
// attacker multiply their effective quota by the number of API instances.
// Reuses the same ioredis connection as token revocation.
//
// `name` distinguishes each limiter's Redis keyspace. express-rate-limit's
// default keyGenerator returns only `req.ip` — without a per-limiter prefix,
// every limiter built from this factory would increment the SAME `rl:<ip>`
// counter, so e.g. exhausting /login's quota would also start rejecting that
// IP's /forgot-password or /reset-password requests, and vice versa. Each
// limiter needs its own counter namespace to actually gate its own route.
export function rateLimiter(
  name: string,
  maxRequests: number,
  windowMs: number = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10)
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        (redis.call as (...cmd: string[]) => Promise<unknown>)(...args) as Promise<
          string | number | boolean | (string | number | boolean)[]
        >,
      prefix: `rl:${name}:`,
    }),
    // Fail OPEN on a Redis outage — same philosophy as the revocation check
    // in authenticate() below. Rate limiting is a defense-in-depth control;
    // treating a Redis blip as "reject every request" would take the whole
    // API down for a much smaller problem than the one it's guarding against.
    passOnStoreError: true,
    handler: (_req, _res, next) => {
      next(new RateLimitError());
    },
    skip: (req) => req.ip === '127.0.0.1' && process.env.NODE_ENV === 'test',
  });
}

// ── Pre-configured limiters ──────────────────────────────────
export const loginLimiter      = rateLimiter('login',    parseInt(process.env.RATE_LIMIT_LOGIN      ?? '10', 10));
export const registerLimiter   = rateLimiter('register', parseInt(process.env.RATE_LIMIT_REGISTER   ?? '5',  10));
export const passwordLimiter   = rateLimiter('password-reset', parseInt(process.env.RATE_LIMIT_PASSWORD_RESET ?? '5', 10));
export const uploadLimiter     = rateLimiter('upload',   parseInt(process.env.RATE_LIMIT_UPLOAD     ?? '20', 10));
// Phase 2 item 10: endpoints that previously shipped with no rate limit at all.
export const refreshLimiter     = rateLimiter('refresh',      parseInt(process.env.RATE_LIMIT_REFRESH      ?? '30', 10));
export const verifyEmailLimiter = rateLimiter('verify-email', parseInt(process.env.RATE_LIMIT_VERIFY_EMAIL ?? '10', 10));
export const webhookLimiter     = rateLimiter('webhook',       parseInt(process.env.RATE_LIMIT_WEBHOOK       ?? '60', 10));
// Separate from passwordLimiter (which now guards /reset-password only) so a
// burst of reset REQUESTS can't also lock a legitimate user out of redeeming
// the link they already received, and vice versa.
export const forgotPasswordLimiter = rateLimiter('forgot-password', parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD ?? '5', 10));
