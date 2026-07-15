/**
 * Waitlist Controller — anti-scalping companion endpoints.
 *
 * Customers register interest in a court/time window. When a prime-time slot
 * is cancelled, the cancel interceptor (booking.controller.ts) issues the top
 * matching entry a 5-minute exclusive slot hold with a single-use claim token
 * (emailed; only its SHA-256 hash is stored). Booking creation honours the
 * hold: nobody else — human or bot — can take the slot while it is active.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

const joinSchema = z.object({
  courtId:      z.string().uuid().nullable().optional(),   // null/omitted = any court
  desiredStart: z.string().datetime({ offset: true }).or(z.string().datetime()),
  desiredEnd:   z.string().datetime({ offset: true }).or(z.string().datetime()),
});

// ── POST /api/waitlist (customer) ─────────────────────────────
export async function joinWaitlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = joinSchema.parse(req.body);
    const start = new Date(parsed.desiredStart);
    const end   = new Date(parsed.desiredEnd);
    if (!(end > start))              throw new ValidationError('desiredEnd must be after desiredStart');
    if (start.getTime() < Date.now()) throw new ValidationError('The desired window must be in the future');

    const { rows } = await db.query(
      `INSERT INTO waitlist_entries (club_id, user_id, court_id, desired_start, desired_end)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [CLUB_ID, req.user!.sub, parsed.courtId ?? null, parsed.desiredStart, parsed.desiredEnd]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.WAITLIST_JOINED,
      entityType: 'waitlist_entry', entityId: rows[0].id,
      newValues: { courtId: parsed.courtId ?? 'any', desiredStart: parsed.desiredStart, desiredEnd: parsed.desiredEnd },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── GET /api/waitlist/me ──────────────────────────────────────
// The caller's open entries plus any active hold issued to them. The claim
// token itself is never returned here — it was delivered once, via email.
export async function myWaitlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows: entries } = await db.query(
      `SELECT w.id, w.court_id, c.name AS court_name, w.desired_start, w.desired_end,
              w.fulfilled_at, w.created_at
       FROM waitlist_entries w
       LEFT JOIN courts c ON c.id = w.court_id
       WHERE w.club_id = $1 AND w.user_id = $2
       ORDER BY w.created_at DESC`,
      [CLUB_ID, req.user!.sub]
    );

    const { rows: holds } = await db.query(
      `SELECT h.id, h.court_id, c.name AS court_name, h.start_time, h.end_time,
              h.expires_at, h.claimed_at
       FROM slot_holds h
       JOIN courts c ON c.id = h.court_id
       WHERE h.club_id = $1 AND h.user_id = $2
         AND h.claimed_at IS NULL AND h.expires_at > NOW()`,
      [CLUB_ID, req.user!.sub]
    );

    res.json({ entries, activeHolds: holds });
  } catch (err) { next(err); }
}

// ── DELETE /api/waitlist/:id ──────────────────────────────────
export async function leaveWaitlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `DELETE FROM waitlist_entries
       WHERE id = $1 AND club_id = $2 AND user_id = $3 AND fulfilled_at IS NULL
       RETURNING id`,
      [req.params.id, CLUB_ID, req.user!.sub]
    );
    if (!rows.length) throw new NotFoundError('Open waitlist entry', req.params.id);
    res.json({ message: 'Removed from the waitlist' });
  } catch (err) { next(err); }
}
