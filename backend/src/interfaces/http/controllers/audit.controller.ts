import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';


export async function listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, entityType, actionType, from, to, page = '1', limit = '50' } = req.query as Record<string, string>;
    const params: unknown[] = [clubIdOf(req)];
    const conditions = ['club_id = $1'];

    if (userId)     { params.push(userId);     conditions.push(`user_id = $${params.length}`); }
    if (entityType) { params.push(entityType); conditions.push(`entity_type = $${params.length}`); }
    if (actionType) { params.push(actionType); conditions.push(`action_type = $${params.length}`); }
    if (from)       { params.push(from);       conditions.push(`timestamp_utc >= $${params.length}`); }
    if (to)         { params.push(to);         conditions.push(`timestamp_utc <= $${params.length}`); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(
      `SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp_utc DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE ${conditions.join(' AND ')}`,
      params.slice(0, params.length - 2)
    );

    res.json({ data: rows, total: parseInt(countRows[0].total), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
}
