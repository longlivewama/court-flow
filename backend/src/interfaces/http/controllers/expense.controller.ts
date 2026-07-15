/**
 * Expense Controller – club operating costs (owner only).
 *
 * Expenses (electricity, salaries, maintenance, gear purchases …) are the
 * cost side of the net-profit equation surfaced on the Finance dashboard.
 * Every mutation is audit-logged.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

export const EXPENSE_CATEGORIES = [
  'electricity', 'water', 'salaries', 'maintenance', 'gear', 'marketing', 'other',
] as const;

const upsertSchema = z.object({
  category:    z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(1).max(255),
  amount:      z.number().positive(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expenseDate must be YYYY-MM-DD'),
});

// ── GET /api/expenses?range_days=90&category=… ────────────────
export async function listExpenses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '90', 10) || 90, 7), 730);
    const category  = req.query.category as string | undefined;

    const params: unknown[] = [CLUB_ID, rangeDays];
    let categoryFilter = '';
    if (category && (EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
      params.push(category);
      categoryFilter = `AND e.category = $3`;
    }

    const { rows } = await db.query(
      `SELECT e.id, e.category, e.description, e.amount, e.expense_date,
              e.created_at, u.first_name || ' ' || u.last_name AS created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.club_id = $1
         AND e.expense_date >= CURRENT_DATE - ($2 || ' days')::interval
         ${categoryFilter}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      params
    );

    const { rows: totals } = await db.query(
      `SELECT category, COALESCE(SUM(amount), 0)::numeric AS total
       FROM expenses
       WHERE club_id = $1 AND expense_date >= CURRENT_DATE - ($2 || ' days')::interval
       GROUP BY category ORDER BY total DESC`,
      [CLUB_ID, rangeDays]
    );

    res.json({
      data: rows,
      byCategory: totals.map((t) => ({ category: t.category, total: Number(t.total) })),
      total: totals.reduce((s, t) => s + Number(t.total), 0),
    });
  } catch (err) { next(err); }
}

// ── POST /api/expenses (owner) ────────────────────────────────
export async function createExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = upsertSchema.parse(req.body);

    const { rows } = await db.query(
      `INSERT INTO expenses (club_id, category, description, amount, expense_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [CLUB_ID, parsed.category, parsed.description, parsed.amount, parsed.expenseDate, req.user!.sub]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EXPENSE_CREATED,
      entityType: 'expense', entityId: rows[0].id,
      newValues: { ...parsed },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── PATCH /api/expenses/:id (owner) ───────────────────────────
export async function updateExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = upsertSchema.partial().parse(req.body);

    const { rows: existingRows } = await db.query(
      `SELECT * FROM expenses WHERE id = $1 AND club_id = $2`,
      [req.params.id, CLUB_ID]
    );
    if (!existingRows.length) throw new NotFoundError('Expense', req.params.id);
    const existing = existingRows[0];

    const { rows } = await db.query(
      `UPDATE expenses
         SET category     = COALESCE($2, category),
             description  = COALESCE($3, description),
             amount       = COALESCE($4, amount),
             expense_date = COALESCE($5, expense_date),
             updated_at   = NOW()
       WHERE id = $1 AND club_id = $6
       RETURNING *`,
      [req.params.id, parsed.category ?? null, parsed.description ?? null,
       parsed.amount ?? null, parsed.expenseDate ?? null, CLUB_ID]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EXPENSE_UPDATED,
      entityType: 'expense', entityId: req.params.id,
      previousValues: {
        category: existing.category, description: existing.description,
        amount: Number(existing.amount), expenseDate: existing.expense_date,
      },
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── DELETE /api/expenses/:id (owner) ──────────────────────────
export async function deleteExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `DELETE FROM expenses WHERE id = $1 AND club_id = $2
       RETURNING id, category, description, amount`,
      [req.params.id, CLUB_ID]
    );
    if (!rows.length) throw new NotFoundError('Expense', req.params.id);

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.EXPENSE_DELETED,
      entityType: 'expense', entityId: req.params.id,
      previousValues: {
        category: rows[0].category, description: rows[0].description,
        amount: Number(rows[0].amount),
      },
    });

    res.json({ message: 'Expense removed' });
  } catch (err) { next(err); }
}
