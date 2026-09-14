import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { parsePagination, parseDateParam } from '../../../shared/query-params';


export async function listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, entityType, actionType } = req.query as Record<string, string>;
    const from = parseDateParam(req.query.from, 'from');
    const to   = parseDateParam(req.query.to, 'to');
    const { page, limit, offset } = parsePagination(req.query, { limit: 50, maxLimit: 200 });

    const params: unknown[] = [clubIdOf(req)];
    const conditions = ['club_id = $1'];

    if (userId)     { params.push(userId);     conditions.push(`user_id = $${params.length}`); }
    if (entityType) { params.push(entityType); conditions.push(`entity_type = $${params.length}`); }
    if (actionType) { params.push(actionType); conditions.push(`action_type = $${params.length}`); }
    if (from)       { params.push(from);       conditions.push(`timestamp_utc >= $${params.length}`); }
    if (to)         { params.push(to);         conditions.push(`timestamp_utc <= $${params.length}`); }

    params.push(limit, offset);

    const { rows } = await db.query(
      `SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp_utc DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE ${conditions.join(' AND ')}`,
      params.slice(0, params.length - 2)
    );

    res.json({ data: rows, total: parseInt(countRows[0].total), page, limit });
  } catch (err) { next(err); }
}
