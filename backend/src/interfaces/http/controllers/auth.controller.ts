/**
 * Auth Controller – handles registration, login, email verification, refresh, logout, password reset.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../infrastructure/database/client';
import { redis, CACHE_KEYS, CACHE_TTL } from '../../../infrastructure/cache/redis.client';
import { hashPassword, verifyPassword } from '../../../infrastructure/auth/argon2.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../../infrastructure/auth/jwt.service';
import { emailService } from '../../../infrastructure/email/email.service';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { ValidationError, UnauthorizedError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { withTransaction } from '../../../infrastructure/database/client';

const CLUB_ID = process.env.CLUB_ID!;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MINUTES  = 15;
const isProduction = process.env.NODE_ENV === 'production';

// ── POST /api/auth/register ───────────────────────────────────
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    // Check email uniqueness
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE club_id=$1 AND email=$2`,
      [CLUB_ID, email.toLowerCase()]
    );
    if (existing.length) {
      throw new ValidationError('An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const userId       = uuidv4();
    const emailVerified = !isProduction;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id,club_id,email,password_hash,role,first_name,last_name,phone,email_verified)
         VALUES ($1,$2,$3,$4,'customer',$5,$6,$7,$8)`,
        [userId, CLUB_ID, email.toLowerCase(), passwordHash, firstName, lastName, phone ?? null, emailVerified]
      );

      // Create verification token (24h, stored hashed)
      const rawToken   = crypto.randomBytes(32).toString('hex');
      const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO email_verifications (user_id,token_hash,expires_at) VALUES ($1,$2,$3)`,
        [userId, tokenHash, expiresAt.toISOString()]
      );

      const link = `${process.env.FRONTEND_URL}/verify-email?token=${rawToken}`;
      if (process.env.NODE_ENV === 'development') {
        console.log(`Verification link for ${email}: ${link}`);
      } else {
        try {
          await emailService.sendVerificationEmail({ to: email, firstName, verificationLink: link });
        } catch (err) {
          console.log(`Verification link for ${email}: ${link}`);
          logger.warn({ err, email }, 'Verification email failed; registration will continue');
        }
      }

      await auditLog({
        clubId: CLUB_ID, userId, userRole: 'customer',
        ipAddress: req.ip, deviceInfo: req.headers['user-agent'],
        actionType: AUDIT_ACTIONS.USER_REGISTERED, entityType: 'user', entityId: userId,
      });
    });

    res.status(201).json({ message: 'Registration successful. Please verify your email.' });
  } catch (err) { next(err); }
}

// ── POST /api/auth/verify-email ───────────────────────────────
export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { rows } = await db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at FROM email_verifications WHERE token_hash=$1`,
      [tokenHash]
    );
    if (!rows.length || rows[0].used_at || rows[0].expires_at < new Date()) {
      throw new ValidationError('Invalid or expired verification link');
    }

    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET email_verified=true, updated_at=NOW() WHERE id=$1`, [rows[0].user_id]);
      await client.query(`UPDATE email_verifications SET used_at=NOW() WHERE id=$1`, [rows[0].id]);
    });

    await auditLog({
      clubId: CLUB_ID, userId: rows[0].user_id, userRole: 'customer',
      actionType: AUDIT_ACTIONS.USER_EMAIL_VERIFIED, entityType: 'user', entityId: rows[0].user_id,
    });

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) { next(err); }
}

// ── POST /api/auth/login ──────────────────────────────────────
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    const { rows } = await db.query<{
      id: string; password_hash: string; role: string; first_name: string;
      email_verified: boolean; is_active: boolean; failed_login_attempts: number; locked_until: Date | null;
    }>(
      `SELECT id,password_hash,role,first_name,email_verified,is_active,failed_login_attempts,locked_until
       FROM users WHERE club_id=$1 AND email=$2`,
      [CLUB_ID, email.toLowerCase()]
    );

    // Generic error to prevent user enumeration
    const invalidCreds = new UnauthorizedError('Invalid email or password');
    if (!rows.length) throw invalidCreds;

    const user = rows[0];
    if (!user.is_active) throw new UnauthorizedError('Account is deactivated');
    if (isProduction && !user.email_verified) throw new UnauthorizedError('Please verify your email before logging in');

    // Lockout check
    if (user.locked_until && user.locked_until > new Date()) {
      await auditLog({ clubId: CLUB_ID, userId: user.id, userRole: user.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGIN_FAILED, entityType: 'user', entityId: user.id,
        reason: 'Account locked' });
      throw new UnauthorizedError(`Account is temporarily locked. Try again after ${user.locked_until.toISOString()}`);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const lockedUntil = attempts >= LOCKOUT_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;

      await db.query(
        `UPDATE users SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3`,
        [attempts, lockedUntil, user.id]
      );
      await auditLog({ clubId: CLUB_ID, userId: user.id, userRole: user.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGIN_FAILED, entityType: 'user', entityId: user.id });
      throw invalidCreds;
    }

    // Reset failed attempts on success
    await db.query(`UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1`, [user.id]);

    const tokenPayload = { sub: user.id, email, role: user.role, clubId: CLUB_ID };
    const accessToken  = signAccessToken(tokenPayload);
    const { token: refreshToken, jti: refreshJti } = signRefreshToken(tokenPayload);

    // Store refresh token hash in DB
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO refresh_tokens (user_id,token_hash,ip_address,device_info,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [user.id, refreshHash, req.ip, req.headers['user-agent'], refreshExpiry.toISOString()]
    );

    // Set refresh token in HttpOnly, Secure, SameSite=Strict cookie
    res.cookie('courtflow_refresh', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     '/api/auth/refresh',
    });

    await auditLog({ clubId: CLUB_ID, userId: user.id, userRole: user.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGIN, entityType: 'user', entityId: user.id });

    res.json({
      accessToken,
      user: { id: user.id, email, role: user.role, firstName: user.first_name },
    });
  } catch (err) { next(err); }
}

// ── POST /api/auth/refresh ────────────────────────────────────
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.courtflow_refresh;
    if (!refreshToken) throw new UnauthorizedError('No refresh token');

    const payload = verifyRefreshToken(refreshToken);

    // Check DB for active refresh token
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await db.query<{ id: string; revoked_at: Date | null }>(
      `SELECT id, revoked_at FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2`,
      [tokenHash, payload.sub]
    );
    if (!rows.length || rows[0].revoked_at) throw new UnauthorizedError('Refresh token revoked');

    // Issue new access token
    const newAccessToken = signAccessToken({
      sub: payload.sub, email: payload.email, role: payload.role, clubId: payload.clubId,
    });

    res.json({ accessToken: newAccessToken });
  } catch (err) { next(err); }
}

// ── POST /api/auth/logout ─────────────────────────────────────
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.courtflow_refresh;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await db.query(`UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1`, [tokenHash]);
    }

    // Add access token to revocation list in Redis
    if (req.user?.jti) {
      const ttl = Math.max(0, (req.user.exp ?? 0) - Math.floor(Date.now() / 1000));
      await redis.setex(CACHE_KEYS.tokenRevoked(req.user.jti), ttl + 60, '1');
    }

    res.clearCookie('courtflow_refresh', { path: '/api/auth/refresh' });

    await auditLog({ clubId: CLUB_ID, userId: req.user?.sub, userRole: req.user?.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGOUT, entityType: 'user', entityId: req.user?.sub });

    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
}

// ── GET /api/users ──────────────────────────────────────────
// Returns all customers for the club. Gated to receptionist + owner
// so staff can pick a customer when creating a booking on their behalf.
export async function listCustomers(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { search } = req.query as Record<string, string>;

    const params: unknown[] = [CLUB_ID];
    let searchClause = '';
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      searchClause = `AND (LOWER(first_name) LIKE $2
                       OR LOWER(last_name)  LIKE $2
                       OR LOWER(email)      LIKE $2)`;
    }

    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, phone
         FROM users
        WHERE club_id = $1
          AND role = 'customer'
          AND is_active = true
          ${searchClause}
        ORDER BY first_name, last_name
        LIMIT 100`,
      params
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
}

