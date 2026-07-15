/**
 * Equipment Controller – rental inventory CRUD.
 *
 * Any authenticated user can read the active catalogue (it powers the booking
 * drawer's Add-ons section). Only the owner can create, edit stock/prices, or
 * retire items; every mutation is audit-logged.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

// ── GET /api/equipment ────────────────────────────────────────
// Customers see the active catalogue; the owner may pass ?all=1 to include
// retired items for inventory management.
export async function listEquipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeInactive = req.query.all === '1' && req.user!.role === 'owner';

    const { rows } = await db.query(
      `SELECT e.id, e.name, e.category, e.description, e.hourly_price, e.stock_qty,
              e.is_active, e.created_at, e.updated_at,
              -- units currently out with in-progress sessions (live utilisation)
              COALESCE((
                SELECT SUM(be.quantity)::int
                FROM booking_equipment be
                JOIN bookings b ON b.id = be.booking_id
                WHERE be.equipment_id = e.id
                  AND b.deleted_at IS NULL
                  AND b.status IN ('confirmed','checked_in')
                  AND b.start_time <= NOW() AND b.end_time > NOW()
              ), 0) AS in_use_now
       FROM equipment e
       WHERE e.club_id = $1 ${includeInactive ? '' : 'AND e.is_active = TRUE'}
       ORDER BY e.category, e.name`,
      [CLUB_ID]
    );

    res.json({ data: rows });
  } catch (err) { next(err); }
}

const upsertSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  category:    z.string().trim().min(1).max(50).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  hourlyPrice: z.number().min(0).optional(),
  hourly_price: z.number().min(0).optional(),
  stockQty:    z.number().int().min(0).optional(),
  stock_qty:   z.number().int().min(0).optional(),
  isActive:    z.boolean().optional(),
  is_active:   z.boolean().optional(),
});

// ── POST /api/equipment (owner) ───────────────────────────────
export async function createEquipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = upsertSchema.parse(req.body);
    const name        = parsed.name;
    const hourlyPrice = parsed.hourlyPrice ?? parsed.hourly_price;
    const stockQty    = parsed.stockQty ?? parsed.stock_qty ?? 0;

    if (!name)                    throw new ValidationError('name is required');
    if (hourlyPrice === undefined) throw new ValidationError('hourlyPrice is required');

    const { rows } = await db.query(
      `INSERT INTO equipment (club_id, name, category, description, hourly_price, stock_qty)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [CLUB_ID, name, parsed.category ?? 'racket', parsed.description ?? null, hourlyPrice, stockQty]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EQUIPMENT_CREATED,
      entityType: 'equipment', entityId: rows[0].id,
      newValues: { name, hourlyPrice, stockQty },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── PATCH /api/equipment/:id (owner) ──────────────────────────
export async function updateEquipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = upsertSchema.parse(req.body);
    const hourlyPrice = parsed.hourlyPrice ?? parsed.hourly_price;
    const stockQty    = parsed.stockQty ?? parsed.stock_qty;
    const isActive    = parsed.isActive ?? parsed.is_active;

    const { rows: existingRows } = await db.query(
      `SELECT * FROM equipment WHERE id = $1 AND club_id = $2`,
      [req.params.id, CLUB_ID]
    );
    if (!existingRows.length) throw new NotFoundError('Equipment', req.params.id);
    const existing = existingRows[0];

    const { rows } = await db.query(
      `UPDATE equipment
         SET name         = COALESCE($2, name),
             category     = COALESCE($3, category),
             description  = COALESCE($4, description),
             hourly_price = COALESCE($5, hourly_price),
             stock_qty    = COALESCE($6, stock_qty),
             is_active    = COALESCE($7, is_active),
             updated_at   = NOW()
       WHERE id = $1 AND club_id = $8
       RETURNING *`,
      [
        req.params.id, parsed.name ?? null, parsed.category ?? null,
        parsed.description ?? null, hourlyPrice ?? null, stockQty ?? null,
        isActive ?? null, CLUB_ID,
      ]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EQUIPMENT_UPDATED,
      entityType: 'equipment', entityId: req.params.id,
      previousValues: {
        name: existing.name, hourlyPrice: Number(existing.hourly_price),
        stockQty: existing.stock_qty, isActive: existing.is_active,
      },
      newValues: { name: parsed.name, hourlyPrice, stockQty, isActive },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── DELETE /api/equipment/:id (owner) ─────────────────────────
// Soft-retire: booking_equipment rows reference the item forever, so we flip
// is_active instead of deleting the row.
export async function deleteEquipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `UPDATE equipment SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND club_id = $2 RETURNING id, name`,
      [req.params.id, CLUB_ID]
    );
    if (!rows.length) throw new NotFoundError('Equipment', req.params.id);

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EQUIPMENT_DELETED,
      entityType: 'equipment', entityId: req.params.id,
      newValues: { name: rows[0].name, isActive: false },
    });

    res.json({ message: 'Equipment retired from the rental catalogue' });
  } catch (err) { next(err); }
}
