/**
 * Authentication & RBAC Middleware
 *
 * authenticate:   Verifies JWT, attaches user to request
 * requireRole:    Enforces RBAC – rejects if user role not in allowed list
 * rateLimiter:    Per-IP rate limiting factory
 */
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import {
  verifyAccessToken,
  JwtPayload,
} from '../../../infrastructure/auth/jwt.service';
import { redis, CACHE_KEYS } from '../../../infrastructure/cache/redis.client';
import {
  UnauthorizedError,
  ForbiddenError,
} from '../../../shared/errors';
import { logger } from '../../../shared/logger';

// Extend Express Request to carry the authenticated user
declare global {
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
export function rateLimiter(
  maxRequests: number,
  windowMs: number = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10)
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new (require('../../../shared/errors').RateLimitError)());
    },
    skip: (req) => req.ip === '127.0.0.1' && process.env.NODE_ENV === 'test',
  });
}

// ── Pre-configured limiters ──────────────────────────────────
export const loginLimiter      = rateLimiter(parseInt(process.env.RATE_LIMIT_LOGIN      ?? '10', 10));
export const registerLimiter   = rateLimiter(parseInt(process.env.RATE_LIMIT_REGISTER   ?? '5',  10));
export const passwordLimiter   = rateLimiter(parseInt(process.env.RATE_LIMIT_PASSWORD_RESET ?? '5', 10));
export const uploadLimiter     = rateLimiter(parseInt(process.env.RATE_LIMIT_UPLOAD     ?? '20', 10));
