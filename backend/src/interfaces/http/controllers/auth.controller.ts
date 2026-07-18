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
import { clubIdOf, defaultClubId } from '../../../shared/tenant';
import { z } from 'zod';

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MINUTES  = 15;
const isProduction = process.env.NODE_ENV === 'production';

// ── Input schemas ─────────────────────────────────────────────
// Guards the auth entry points: a missing/malformed body now yields a clean
// 400 (Zod → VALIDATION_ERROR via the error middleware) instead of an
// unhandled TypeError → 500.
const PASSWORD_POLICY = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Tenant slug: the club's unique, immutable domain prefix. Lowercase kebab,
// 3–63 chars, no leading/trailing hyphen — mirrors the DB CHECK constraint.
const SLUG_POLICY = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Club slug must be at least 3 characters')
  .max(63, 'Club slug must be at most 63 characters')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, 'Club slug may only contain lowercase letters, numbers and inner hyphens');

// Prefixes that can never become tenant slugs — they collide with routing,
// infrastructure hostnames or the product's own brand.
const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'auth', 'dashboard', 'login', 'register',
  'register-club', 'static', 'assets', 'cdn', 'mail', 'smtp', 'ftp', 'root',
  'support', 'billing', 'status', 'docs', 'help', 'blog', 'courtflow',
]);

const registerSchema = z.object({
  email:     z.string().trim().toLowerCase().email('A valid email is required'),
  password:  PASSWORD_POLICY,
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName:  z.string().trim().min(1, 'Last name is required').max(80),
  phone:     z.string().trim().max(32).optional(),
  // Members may join a specific club workspace; defaults to the flagship club
  clubSlug:  SLUG_POLICY.optional(),
});

const loginSchema = z.object({
  email:    z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
  // Disambiguates when the same email exists in several club workspaces
  clubSlug: SLUG_POLICY.optional(),
});

const registerClubSchema = z.object({
  clubName:  z.string().trim().min(3, 'Club name must be at least 3 characters').max(120),
  clubSlug:  SLUG_POLICY,
  timezone:  z.string().trim().max(100).default('Africa/Cairo'),
  email:     z.string().trim().toLowerCase().email('A valid owner email is required'),
  password:  PASSWORD_POLICY,
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName:  z.string().trim().min(1, 'Last name is required').max(80),
  phone:     z.string().trim().max(32).optional(),
});

/** Resolve an ACTIVE club by slug or fail with a clean 400. */
async function resolveClubBySlug(slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM clubs WHERE slug = $1`,
    [slug]
  );
  if (!rows.length || !rows[0].is_active) {
    throw new ValidationError('Unknown or inactive club workspace');
  }
  return rows[0].id;
}

// ── POST /api/auth/register ───────────────────────────────────
// Member self-signup into an existing club workspace (slug optional —
// defaults to the flagship onboarding club).
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, firstName, lastName, phone, clubSlug } = registerSchema.parse(req.body);

    const targetClubId = clubSlug ? await resolveClubBySlug(clubSlug) : defaultClubId();

    // Check email uniqueness inside this tenant only
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE club_id=$1 AND email=$2`,
      [targetClubId, email]
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
        [userId, targetClubId, email.toLowerCase(), passwordHash, firstName, lastName, phone ?? null, emailVerified]
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
        logger.info({ email, link }, 'Verification link (dev only)');
      } else {
        try {
          await emailService.sendVerificationEmail({ to: email, firstName, verificationLink: link });
        } catch (err) {
          logger.warn({ err, email }, 'Verification email failed; registration will continue — token NOT logged for security');
        }
      }

      await auditLog({
        clubId: targetClubId, userId, userRole: 'customer',
        ipAddress: req.ip, deviceInfo: req.headers['user-agent'],
        actionType: AUDIT_ACTIONS.USER_REGISTERED, entityType: 'user', entityId: userId,
      });
    });

    res.status(201).json({ message: 'Registration successful. Please verify your email.' });
  } catch (err) { next(err); }
}

// ── POST /api/auth/register-club ──────────────────────────────
// Multi-tenant inception: one atomic transaction provisions the tenant row
// (immutable CLUB_ID), the primary Club Owner account bound to it, and the
// club's default operating calendar. A transaction-scoped advisory lock on
// the slug serialises concurrent onboarding races; the UNIQUE constraint on
// clubs.slug is the final arbiter.
export async function registerClub(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      clubName, clubSlug, timezone, email, password, firstName, lastName, phone,
    } = registerClubSchema.parse(req.body);

    if (RESERVED_SLUGS.has(clubSlug)) {
      throw new ValidationError('This club slug is reserved — please choose another');
    }

    const passwordHash  = await hashPassword(password);
    const clubId        = uuidv4();
    const ownerId       = uuidv4();
    const emailVerified = !isProduction;

    try {
      await withTransaction(async (client) => {
        // Serialise concurrent registrations of the same slug
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`club-slug:${clubSlug}`]);

        const { rows: slugTaken } = await client.query(`SELECT 1 FROM clubs WHERE slug=$1`, [clubSlug]);
        if (slugTaken.length) {
          throw new ValidationError('This club slug is already taken');
        }

        await client.query(
          `INSERT INTO clubs (id, name, slug, plan, timezone, currency, is_active)
           VALUES ($1, $2, $3, 'base', $4, 'EGP', TRUE)`,
          [clubId, clubName, clubSlug, timezone]
        );

        await client.query(
          `INSERT INTO users (id, club_id, email, password_hash, role, first_name, last_name, phone, email_verified)
           VALUES ($1, $2, $3, $4, 'owner', $5, $6, $7, $8)`,
          [ownerId, clubId, email, passwordHash, firstName, lastName, phone ?? null, emailVerified]
        );

        // Sensible default operating window (owner refines it in Settings)
        await client.query(
          `INSERT INTO working_hours (club_id, day_of_week, open_time, close_time, is_closed)
           SELECT $1, d, '08:00', '23:00', FALSE FROM generate_series(0, 6) AS d`,
          [clubId]
        );

        // Owner email verification (same contract as member signup)
        const rawToken  = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
          [ownerId, tokenHash, expiresAt.toISOString()]
        );

        const link = `${process.env.FRONTEND_URL}/verify-email?token=${rawToken}`;
        if (process.env.NODE_ENV === 'development') {
          logger.info({ email, link }, 'Owner verification link (dev only)');
        } else {
          try {
            await emailService.sendVerificationEmail({ to: email, firstName, verificationLink: link });
          } catch (err) {
            logger.warn({ err, email }, 'Owner verification email failed; club registration continues — token NOT logged');
          }
        }

        await auditLog({
          clubId, userId: ownerId, userRole: 'owner',
          ipAddress: req.ip, deviceInfo: req.headers['user-agent'],
          actionType: AUDIT_ACTIONS.CLUB_REGISTERED, entityType: 'club', entityId: clubId,
          newValues: { clubName, clubSlug, plan: 'base', timezone },
        });
      });
    } catch (err: unknown) {
      // UNIQUE race fallback — surfaces as a clean 400 rather than a 500
      if ((err as { code?: string }).code === '23505') {
        throw new ValidationError('This club slug is already taken');
      }
      throw err;
    }

    logger.info({ clubId, clubSlug }, 'New club tenant provisioned');
    res.status(201).json({
      message: 'Club registered successfully. Please verify the owner email, then sign in.',
      clubId,
      clubSlug,
    });
  } catch (err) { next(err); }
}

// ── POST /api/auth/verify-email ───────────────────────────────
export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { rows } = await db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null; club_id: string; role: string }>(
      `SELECT ev.id, ev.user_id, ev.expires_at, ev.used_at, u.club_id, u.role
         FROM email_verifications ev
         JOIN users u ON u.id = ev.user_id
        WHERE ev.token_hash=$1`,
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
      clubId: rows[0].club_id, userId: rows[0].user_id, userRole: rows[0].role,
      actionType: AUDIT_ACTIONS.USER_EMAIL_VERIFIED, entityType: 'user', entityId: rows[0].user_id,
    });

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) { next(err); }
}

// ── POST /api/auth/login ──────────────────────────────────────
// Multi-tenant resolution: the user's club workspace is looked up from THEIR
// row (never from an environment constant), the club's own state gates the
// session, and the issued JWT is bound to that immutable club_id.
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, clubSlug } = loginSchema.parse(req.body);

    const params: unknown[] = [email];
    if (clubSlug) params.push(clubSlug);
    const { rows } = await db.query<{
      id: string; club_id: string; club_slug: string; club_active: boolean;
      password_hash: string; role: string; first_name: string;
      email_verified: boolean; is_active: boolean; failed_login_attempts: number; locked_until: Date | null;
    }>(
      `SELECT u.id, u.club_id, c.slug AS club_slug, c.is_active AS club_active,
              u.password_hash, u.role, u.first_name, u.email_verified, u.is_active,
              u.failed_login_attempts, u.locked_until
         FROM users u
         JOIN clubs c ON c.id = u.club_id
        WHERE u.email=$1 ${clubSlug ? 'AND c.slug=$2' : ''}`,
      params
    );

    // Generic error to prevent user enumeration
    const invalidCreds = new UnauthorizedError('Invalid email or password');
    if (!rows.length) throw invalidCreds;

    // Same email in several club workspaces — require the slug to pick one.
    // The slugs themselves are never disclosed pre-authentication.
    if (rows.length > 1) {
      throw new ValidationError(
        'This email belongs to multiple club workspaces. Add your club slug to continue.',
        { code: 'CLUB_SLUG_REQUIRED' }
      );
    }

    const user = rows[0];
    if (!user.club_active) throw new UnauthorizedError('This club workspace is suspended');
    if (!user.is_active) throw new UnauthorizedError('Account is deactivated');
    if (isProduction && !user.email_verified) throw new UnauthorizedError('Please verify your email before logging in');

    // Lockout check
    if (user.locked_until && user.locked_until > new Date()) {
      await auditLog({ clubId: user.club_id, userId: user.id, userRole: user.role,
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
      await auditLog({ clubId: user.club_id, userId: user.id, userRole: user.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGIN_FAILED, entityType: 'user', entityId: user.id });
      throw invalidCreds;
    }

    // Reset failed attempts on success
    await db.query(`UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1`, [user.id]);

    const tokenPayload = { sub: user.id, email, role: user.role, clubId: user.club_id };
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

    await auditLog({ clubId: user.club_id, userId: user.id, userRole: user.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_LOGIN, entityType: 'user', entityId: user.id });

    res.json({
      accessToken,
      user: {
        id: user.id, email, role: user.role, firstName: user.first_name,
        clubId: user.club_id, clubSlug: user.club_slug,
      },
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

    await auditLog({ clubId: clubIdOf(req), userId: req.user?.sub, userRole: req.user?.role,
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

    const params: unknown[] = [clubIdOf(req)];
    let searchClause = '';
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      searchClause = `AND (LOWER(u.first_name) LIKE $2
                       OR LOWER(u.last_name)  LIKE $2
                       OR LOWER(u.email)      LIKE $2)`;
    }

    const { rows } = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at,
              COALESCE(bs.bookings_count, 0)  AS bookings_count,
              COALESCE(bs.total_spent, 0)     AS total_spent,
              bs.last_booking_at
         FROM users u
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings_count,
                  COALESCE(SUM(b.deposit_amount + b.remainder_amount)
                    FILTER (WHERE b.status IN ('confirmed','checked_in','completed','no_show')), 0)::numeric AS total_spent,
                  MAX(b.start_time) AS last_booking_at
           FROM bookings b
           WHERE b.customer_id = u.id AND b.deleted_at IS NULL
         ) bs ON TRUE
        WHERE u.club_id = $1
          AND u.role = 'customer'
          AND u.is_active = true
          ${searchClause}
        ORDER BY bs.bookings_count DESC NULLS LAST, u.first_name, u.last_name
        LIMIT 200`,
      params
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
}

// Granular permission flags — kept in sync with migration 014 and the
// requirePermission() allowlist in tenant.middleware.ts.
const PERMISSION_KEYS = [
  'can_view_schedule',
  'can_verify_deposits',
  'can_manage_coaches',
  'can_view_finance',
] as const;
type PermissionKey = (typeof PERMISSION_KEYS)[number];

const permissionsSchema = z.object({
  can_view_schedule:   z.boolean(),
  can_verify_deposits: z.boolean(),
  can_manage_coaches:  z.boolean(),
  can_view_finance:    z.boolean(),
});

// ── GET /api/users/staff (owner) ──────────────────────────────
// Teammates permissions manager: every non-customer account with its
// active/suspended state and granular permission flags.
export async function listStaff(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, phone, role, is_active,
              email_verified, created_at,
              can_view_schedule, can_verify_deposits, can_manage_coaches, can_view_finance,
              (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
         FROM users
        WHERE club_id = $1 AND role IN ('owner', 'receptionist')
        ORDER BY (role = 'owner') DESC, first_name, last_name`,
      [clubIdOf(req)]
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
}

// ── POST /api/users/staff (owner) ─────────────────────────────
// Provision a desk-staff (receptionist) or co-owner account with an explicit
// granular permission set. A temporary password is generated and returned
// once so the owner can hand it over (owners provision desk staff directly;
// there is no public staff self-signup). Owner accounts implicitly hold every
// permission, so their flags are all forced TRUE regardless of the toggles.
const createStaffSchema = z.object({
  firstName:   z.string().trim().min(1, 'First name is required').max(80),
  lastName:    z.string().trim().min(1, 'Last name is required').max(80),
  email:       z.string().trim().toLowerCase().email('A valid email is required'),
  phone:       z.string().trim().max(32).optional(),
  role:        z.enum(['receptionist', 'owner']).default('receptionist'),
  permissions: permissionsSchema.partial().optional(),
});

/** Temp password guaranteed to satisfy PASSWORD_POLICY (letters + digits). */
function generateTempPassword(): string {
  const raw = crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '');
  return `Cf${raw}9`.slice(0, 16);
}

export async function createStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { firstName, lastName, email, phone, role, permissions } = createStaffSchema.parse(req.body);
    const clubId = clubIdOf(req);

    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE club_id = $1 AND email = $2`,
      [clubId, email]
    );
    if (existing.length) {
      throw new ValidationError('An account with this email already exists in this club');
    }

    // Owners hold every permission; desk staff take the owner's explicit choices
    // (any omitted flag defaults to false — least privilege for new accounts).
    const perms: Record<PermissionKey, boolean> = {
      can_view_schedule:   role === 'owner' ? true : permissions?.can_view_schedule   ?? false,
      can_verify_deposits: role === 'owner' ? true : permissions?.can_verify_deposits ?? false,
      can_manage_coaches:  role === 'owner' ? true : permissions?.can_manage_coaches  ?? false,
      can_view_finance:    role === 'owner' ? true : permissions?.can_view_finance    ?? false,
    };

    const tempPassword  = generateTempPassword();
    const passwordHash  = await hashPassword(tempPassword);
    const userId        = uuidv4();
    const emailVerified = !isProduction; // dev accounts are immediately usable

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users
           (id, club_id, email, password_hash, role, first_name, last_name, phone, email_verified,
            can_view_schedule, can_verify_deposits, can_manage_coaches, can_view_finance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [userId, clubId, email, passwordHash, role, firstName, lastName, phone ?? null, emailVerified,
         perms.can_view_schedule, perms.can_verify_deposits, perms.can_manage_coaches, perms.can_view_finance]
      );

      await auditLog({
        clubId, userId: req.user!.sub, userRole: req.user!.role,
        ipAddress: req.ip, deviceInfo: req.headers['user-agent'],
        actionType: AUDIT_ACTIONS.STAFF_CREATED, entityType: 'user', entityId: userId,
        newValues: { email, role, permissions: perms },
      });
    });

    // Best-effort verification email in production; dev logs the link instead.
    if (isProduction) {
      try {
        const rawToken  = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.query(
          `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
          [userId, tokenHash, expiresAt.toISOString()]
        );
        const link = `${process.env.FRONTEND_URL}/verify-email?token=${rawToken}`;
        await emailService.sendVerificationEmail({ to: email, firstName, verificationLink: link });
      } catch (err) {
        logger.warn({ err, email }, 'Staff verification email failed; account still created');
      }
    }

    res.status(201).json({
      user: { id: userId, email, role, firstName, lastName, isActive: true, permissions: perms },
      // Returned once so the owner can share it; never persisted in plaintext.
      tempPassword,
    });
  } catch (err) { next(err); }
}

// ── PATCH /api/users/:id/permissions (owner) ──────────────────
export async function updateStaffPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = permissionsSchema.parse(req.body);
    const clubId = clubIdOf(req);

    const { rows: targetRows } = await db.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND club_id = $2`,
      [req.params.id, clubId]
    );
    if (!targetRows.length) throw new NotFoundError('User', req.params.id);
    if (targetRows[0].role === 'owner') {
      throw new ValidationError('Owner accounts already hold every permission');
    }

    const { rows } = await db.query(
      `UPDATE users
          SET can_view_schedule = $2, can_verify_deposits = $3,
              can_manage_coaches = $4, can_view_finance = $5, updated_at = NOW()
        WHERE id = $1 AND club_id = $6
        RETURNING id, email, first_name, last_name, role, is_active,
                  can_view_schedule, can_verify_deposits, can_manage_coaches, can_view_finance`,
      [req.params.id, parsed.can_view_schedule, parsed.can_verify_deposits,
       parsed.can_manage_coaches, parsed.can_view_finance, clubId]
    );

    await auditLog({
      clubId, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.STAFF_PERMISSIONS_UPDATED,
      entityType: 'user', entityId: req.params.id,
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── DELETE /api/users/:id (owner) ─────────────────────────────
// Remove a teammate. A clean account (no booking/payment/audit history) is
// hard-deleted; one with referencing activity is deactivated + token-revoked
// instead, so we never orphan or corrupt the club's financial/audit trail.
// Guards: never yourself, never the last active owner.
export async function deleteStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clubId = clubIdOf(req);

    if (req.params.id === req.user!.sub) {
      throw new ValidationError('You cannot remove your own account');
    }

    const { rows: targetRows } = await db.query<{ role: string; email: string; is_active: boolean }>(
      `SELECT role, email, is_active FROM users WHERE id = $1 AND club_id = $2`,
      [req.params.id, clubId]
    );
    if (!targetRows.length) throw new NotFoundError('User', req.params.id);
    const target = targetRows[0];

    if (target.role === 'owner') {
      const { rows: ownerCount } = await db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM users
          WHERE club_id = $1 AND role = 'owner' AND is_active = TRUE AND id <> $2`,
        [clubId, req.params.id]
      );
      if (parseInt(ownerCount[0].n, 10) === 0) {
        throw new ValidationError('Cannot remove the last active owner of the club');
      }
    }

    // Refresh tokens / verifications / waitlist rows cascade on delete; the
    // coach link is SET NULL. Activity FKs (bookings.created_by, payments.*,
    // refunds.*, sessions.*) have no cascade and will raise 23503 → deactivate.
    let mode: 'deleted' | 'deactivated';
    try {
      const { rowCount } = await db.query(
        `DELETE FROM users WHERE id = $1 AND club_id = $2`,
        [req.params.id, clubId]
      );
      if (!rowCount) throw new NotFoundError('User', req.params.id);
      mode = 'deleted';
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23503') {
        await db.query(
          `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
          [req.params.id, clubId]
        );
        await db.query(
          `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
          [req.params.id]
        );
        mode = 'deactivated';
      } else {
        throw err;
      }
    }

    await auditLog({
      clubId, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.STAFF_REMOVED,
      entityType: 'user', entityId: req.params.id,
      newValues: { email: target.email, role: target.role, mode },
    });

    res.json({ id: req.params.id, removed: mode });
  } catch (err) { next(err); }
}

// ── PATCH /api/users/:id/status (owner) ───────────────────────
// Suspend / reactivate a teammate. Owners cannot suspend themselves —
// that would lock the club out of its own admin panel.
export async function setUserStatus(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const statusSchema = z.object({ isActive: z.boolean() });
    const { isActive } = statusSchema.parse(req.body);

    if (req.params.id === req.user!.sub) {
      throw new ValidationError('You cannot change your own account status');
    }

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = $2, updated_at = NOW()
        WHERE id = $1 AND club_id = $3
        RETURNING id, email, first_name, last_name, role, is_active`,
      [req.params.id, isActive, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('User', req.params.id);

    // Suspending an account also revokes its refresh tokens so live
    // sessions die at the next token refresh.
    if (!isActive) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.params.id]
      );
    }

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entityType: 'user', entityId: req.params.id,
      newValues: { isActive, email: rows[0].email, role: rows[0].role },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

