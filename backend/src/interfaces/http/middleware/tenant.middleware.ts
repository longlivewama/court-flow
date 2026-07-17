/**
 * Multi-Tenant Boundary Middleware
 *
 * Two ironclad guarantees enforced on every tenant API route:
 *
 *   1. requireTenant       — the session's JWT must carry a well-formed
 *                            club_id belonging to an ACTIVE club. Runs right
 *                            after `authenticate` on every tenant router.
 *   2. requireClubResource — for parameterized routes (/:id …), the targeted
 *                            row's club_id must equal req.user.clubId.
 *                            Cross-tenant probing returns 404 (existence is
 *                            never leaked to another tenant).
 *
 * Role matrix (DB enum → product role):
 *   owner        → OWNER          full financials, staff, configuration,
 *                                 courts, structural dashboards (own club)
 *   receptionist → STAFF / DESK   operational sheets, deposit validation,
 *                                 check-ins, schedule grid
 *   coach        → COACH          read-only coaching calendars and their
 *                                 allocated training/lesson slots
 *   customer     → MEMBER/CAPTAIN player-facing app: booking, equipment
 *                                 modifiers, team registration, 50% deposits
 *
 * Endpoint-level role permissions stay declared inline in routes.ts via
 * requireRole(...) — this module adds the tenant dimension on top.
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { redis } from '../../../infrastructure/cache/redis.client';
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { logger } from '../../../shared/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLUB_ACTIVE_TTL_S = 60;
const clubActiveKey = (clubId: string) => `club:active:${clubId}`;

/**
 * Verifies the authenticated session is pinned to a valid, active tenant.
 * The club-active flag is cached in Redis for 60s; Redis outages fail open
 * (the JWT is already cryptographically bound to the club_id).
 */
export async function requireTenant(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.user?.clubId;
    if (!clubId || !UUID_RE.test(clubId)) {
      throw new UnauthorizedError('Session carries no valid tenant scope');
    }

    let active: boolean | null = null;
    try {
      const cached = await redis.get(clubActiveKey(clubId));
      if (cached !== null) active = cached === '1';
    } catch { /* cache miss path below decides */ }

    if (active === null) {
      const { rows } = await db.query<{ is_active: boolean }>(
        `SELECT is_active FROM clubs WHERE id = $1`,
        [clubId]
      );
      active = rows.length > 0 && rows[0].is_active;
      try {
        await redis.setex(clubActiveKey(clubId), CLUB_ACTIVE_TTL_S, active ? '1' : '0');
      } catch (err) {
        logger.warn({ err, clubId }, 'Redis unavailable caching club-active flag');
      }
    }

    if (!active) {
      throw new ForbiddenError('This club workspace is suspended or no longer exists');
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Allowlist of tenant tables the resource guard may touch. Never interpolate
// a table name that is not a key of this map.
const GUARDED_TABLES = {
  bookings:          `SELECT club_id FROM bookings          WHERE id = $1`,
  courts:            `SELECT club_id FROM courts            WHERE id = $1`,
  blocked_periods:   `SELECT club_id FROM blocked_periods   WHERE id = $1`,
  equipment:         `SELECT club_id FROM equipment         WHERE id = $1`,
  subscriptions:     `SELECT club_id FROM subscriptions     WHERE id = $1`,
  report_jobs:       `SELECT club_id FROM report_jobs       WHERE id = $1`,
  tournaments:       `SELECT club_id FROM tournaments       WHERE id = $1`,
  expenses:          `SELECT club_id FROM expenses          WHERE id = $1`,
  lost_found_items:  `SELECT club_id FROM lost_found_items  WHERE id = $1`,
  coaches:           `SELECT club_id FROM coaches           WHERE id = $1`,
  training_sessions: `SELECT club_id FROM training_sessions WHERE id = $1`,
  waitlist_entries:  `SELECT club_id FROM waitlist_entries  WHERE id = $1`,
  users:             `SELECT club_id FROM users             WHERE id = $1`,
  // refunds carry no club_id column — tenancy resolves through the booking
  refunds: `SELECT b.club_id FROM refunds r
              JOIN bookings b ON b.id = r.booking_id
             WHERE r.id = $1`,
} as const;

export type GuardedTable = keyof typeof GUARDED_TABLES;

/**
 * Factory: strict per-resource tenant guard.
 *
 *   bookings.get('/:id', requireClubResource('bookings'), handler)
 *
 * Looks up the targeted row's club_id and rejects unless it matches the
 * session's club_id. A cross-tenant id responds 404 — indistinguishable from
 * a nonexistent id, so tenants cannot enumerate each other's resources.
 */
export function requireClubResource(table: GuardedTable, idParam = 'id') {
  const sql = GUARDED_TABLES[table];
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.clubId) throw new UnauthorizedError();

      const resourceId = req.params[idParam];
      // Malformed UUIDs would throw a DB cast error → treat as not found
      if (!resourceId || !UUID_RE.test(resourceId)) {
        throw new NotFoundError('Resource', resourceId ?? '(missing id)');
      }

      const { rows } = await db.query<{ club_id: string }>(sql, [resourceId]);
      if (!rows.length || rows[0].club_id !== req.user.clubId) {
        if (rows.length) {
          logger.warn(
            { table, resourceId, requesterClub: req.user.clubId, resourceClub: rows[0].club_id, userId: req.user.sub },
            'Cross-tenant access attempt blocked'
          );
        }
        throw new NotFoundError('Resource', resourceId);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
