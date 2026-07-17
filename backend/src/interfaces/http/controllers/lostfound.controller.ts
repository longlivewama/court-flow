/**
 * Lost & Found Controller – the digital found-items board.
 *
 * Staff photograph a found item, log where (court) and when it was found;
 * customers browse the board and submit claim requests. Staff approve or
 * reject claims and mark items returned.
 *
 * Photos are small, non-sensitive JPEG/PNG/WebP images stored inline as
 * bytea and streamed from GET /:id/photo (unlike payment receipts, which
 * stay in encrypted file storage).
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError, ConflictError } from '../../../shared/errors';


const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export function photoUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  upload.single('photo')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Photo exceeds the 5 MB limit'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected file field '${err.field}'. Upload the image under the 'photo' field.`
          : err.message;
      next(new ValidationError(message));
      return;
    }
    next(err);
  });
}

// ── GET /api/lost-found ───────────────────────────────────────
// Everyone sees the board. Customers additionally get their own claim's
// status; staff get the pending-claim count per item.
export async function listItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const staff = ['receptionist', 'owner', 'admin'].includes(req.user!.role);
    const includeReturned = req.query.all === '1' && staff;

    const { rows } = await db.query(
      `SELECT i.id, i.title, i.description, i.found_at, i.status, i.created_at,
              (i.photo_data IS NOT NULL) AS has_photo,
              c.name AS court_name, c.number AS court_number,
              (SELECT COUNT(*)::int FROM lost_found_claims lc
                WHERE lc.item_id = i.id AND lc.status = 'pending') AS pending_claims,
              (SELECT lc.status::text FROM lost_found_claims lc
                WHERE lc.item_id = i.id AND lc.claimant_id = $2
                ORDER BY lc.created_at DESC LIMIT 1)  AS my_claim_status
       FROM lost_found_items i
       LEFT JOIN courts c ON c.id = i.court_id
       WHERE i.club_id = $1 ${includeReturned ? '' : `AND i.status <> 'returned'`}
       ORDER BY i.found_at DESC`,
      [clubIdOf(req), req.user!.sub]
    );

    res.json({
      data: rows.map((r) => (staff ? r : { ...r, pending_claims: undefined })),
    });
  } catch (err) { next(err); }
}

// ── GET /api/lost-found/:id/photo ─────────────────────────────
export async function getItemPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query<{ photo_data: Buffer | null; photo_mime: string | null }>(
      `SELECT photo_data, photo_mime FROM lost_found_items WHERE id = $1 AND club_id = $2`,
      [req.params.id, clubIdOf(req)]
    );
    if (!rows.length || !rows[0].photo_data) throw new NotFoundError('Photo for item', req.params.id);

    res.setHeader('Content-Type', rows[0].photo_mime ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(rows[0].photo_data);
  } catch (err) { next(err); }
}

const itemSchema = z.object({
  title:       z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional(),
  courtId:     z.string().uuid().nullable().optional(),
  foundAt:     z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
});

// ── POST /api/lost-found (staff, multipart) ───────────────────
export async function createItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Multipart text fields arrive as strings; coerce empties to undefined
    const body = {
      title:       req.body.title,
      description: req.body.description || undefined,
      courtId:     req.body.courtId || undefined,
      foundAt:     req.body.foundAt || undefined,
    };
    const parsed = itemSchema.parse(body);

    if (req.file && !ALLOWED_MIMES.includes(req.file.mimetype)) {
      throw new ValidationError('Photo must be a JPEG, PNG or WebP image');
    }

    const { rows } = await db.query(
      `INSERT INTO lost_found_items
         (club_id, title, description, court_id, found_at, photo_data, photo_mime, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5, NOW()),$6,$7,$8)
       RETURNING id, title, description, court_id, found_at, status, created_at,
                 (photo_data IS NOT NULL) AS has_photo`,
      [clubIdOf(req), parsed.title, parsed.description ?? null, parsed.courtId ?? null,
       parsed.foundAt ?? null, req.file?.buffer ?? null, req.file?.mimetype ?? null, req.user!.sub]
    );

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.LOST_ITEM_LOGGED,
      entityType: 'lost_found_item', entityId: rows[0].id,
      newValues: { title: parsed.title, courtId: parsed.courtId, hasPhoto: !!req.file },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

const itemPatchSchema = z.object({
  status: z.enum(['unclaimed', 'claimed', 'returned']).optional(),
  title:  z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

// ── PATCH /api/lost-found/:id (staff) ─────────────────────────
export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = itemPatchSchema.parse(req.body);

    const { rows } = await db.query(
      `UPDATE lost_found_items
         SET status = COALESCE($2, status),
             title  = COALESCE($3, title),
             description = COALESCE($4, description),
             updated_at  = NOW()
       WHERE id = $1 AND club_id = $5
       RETURNING id, title, description, found_at, status,
                 (photo_data IS NOT NULL) AS has_photo`,
      [req.params.id, parsed.status ?? null, parsed.title ?? null,
       parsed.description ?? null, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Lost & Found item', req.params.id);

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.LOST_ITEM_UPDATED,
      entityType: 'lost_found_item', entityId: req.params.id,
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

const claimSchema = z.object({
  message: z.string().trim().min(5).max(1000),
});

// ── POST /api/lost-found/:id/claims (customer) ────────────────
export async function submitClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = claimSchema.parse(req.body);

    const { rows: itemRows } = await db.query(
      `SELECT id, status FROM lost_found_items WHERE id = $1 AND club_id = $2`,
      [req.params.id, clubIdOf(req)]
    );
    if (!itemRows.length) throw new NotFoundError('Lost & Found item', req.params.id);
    if (itemRows[0].status === 'returned') {
      throw new ConflictError('This item has already been returned to its owner');
    }

    const { rows: existing } = await db.query(
      `SELECT id FROM lost_found_claims WHERE item_id = $1 AND claimant_id = $2`,
      [req.params.id, req.user!.sub]
    );
    if (existing.length) throw new ConflictError('You already submitted a claim for this item');

    const { rows } = await db.query(
      `INSERT INTO lost_found_claims (item_id, claimant_id, message)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user!.sub, parsed.message]
    );

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.LOST_ITEM_CLAIM_SUBMITTED,
      entityType: 'lost_found_claim', entityId: rows[0].id,
      newValues: { itemId: req.params.id },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── GET /api/lost-found/:id/claims (staff) ────────────────────
export async function listClaims(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT lc.id, lc.message, lc.status, lc.created_at, lc.decided_at,
              u.first_name || ' ' || u.last_name AS claimant_name,
              u.email AS claimant_email, u.phone AS claimant_phone
       FROM lost_found_claims lc
       JOIN lost_found_items i ON i.id = lc.item_id
       JOIN users u ON u.id = lc.claimant_id
       WHERE lc.item_id = $1 AND i.club_id = $2
       ORDER BY lc.created_at`,
      [req.params.id, clubIdOf(req)]
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
}

const decideSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

// ── PATCH /api/lost-found/:id/claims/:claimId (staff) ─────────
// Approving a claim marks the item 'claimed' (reserved for pickup) and
// auto-rejects every other pending claim on it.
export async function decideClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = decideSchema.parse(req.body);

    const { rows } = await db.query(
      `UPDATE lost_found_claims lc
         SET status = $3, decided_by = $4, decided_at = NOW()
       FROM lost_found_items i
       WHERE lc.id = $2 AND lc.item_id = $1 AND i.id = lc.item_id AND i.club_id = $5
         AND lc.status = 'pending'
       RETURNING lc.*`,
      [req.params.id, req.params.claimId, parsed.status, req.user!.sub, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Pending claim', req.params.claimId);

    if (parsed.status === 'approved') {
      await db.query(
        `UPDATE lost_found_items SET status = 'claimed', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      await db.query(
        `UPDATE lost_found_claims
           SET status = 'rejected', decided_by = $2, decided_at = NOW()
         WHERE item_id = $1 AND status = 'pending'`,
        [req.params.id, req.user!.sub]
      );
    }

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.LOST_ITEM_CLAIM_DECIDED,
      entityType: 'lost_found_claim', entityId: req.params.claimId,
      newValues: { status: parsed.status, itemId: req.params.id },
    });

    res.json({ ...rows[0], message: `Claim ${parsed.status}` });
  } catch (err) { next(err); }
}
