/**
 * Shared query-parameter validation for list/report endpoints.
 *
 * Several controllers (audit, bookings, payments, reports) parsed `page` /
 * `limit` / `from` / `to` straight out of req.query with bare parseInt() and
 * no validation, then bound the result directly into a SQL LIMIT/OFFSET or a
 * ::date cast. A non-numeric value (parseInt('abc') === NaN) or a malformed
 * date string doesn't get rejected — it reaches Postgres as a raw invalid
 * literal, which throws an unhandled error the global handler turns into an
 * opaque 500 instead of a clean 400. These helpers centralise the fix.
 */
import { z } from 'zod';
import { ValidationError } from './errors';

const paginationQuerySchema = z.object({
  page:  z.coerce.number().int('page must be a whole number').min(1, 'page must be at least 1').optional(),
  limit: z.coerce.number().int('limit must be a whole number').min(1, 'limit must be at least 1').optional(),
});

export interface Pagination { page: number; limit: number; offset: number; }

/**
 * Parses & validates page/limit query params, returning the derived offset.
 * Throws ValidationError (→ 400 via the global error handler) on anything
 * that isn't a positive integer, instead of letting parseInt's NaN reach SQL.
 */
export function parsePagination(
  query: Record<string, unknown>,
  defaults: { limit: number; maxLimit?: number }
): Pagination {
  const maxLimit = defaults.maxLimit ?? 100;
  const parsed = paginationQuerySchema.safeParse({ page: query.page, limit: query.limit });
  if (!parsed.success) {
    throw new ValidationError('Invalid pagination parameters', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const page  = parsed.data.page  ?? 1;
  const limit = parsed.data.limit ?? defaults.limit;
  if (limit > maxLimit) {
    throw new ValidationError(`limit must not exceed ${maxLimit}`);
  }
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Validates an optional date-only or ISO-timestamp query param. Returns
 * undefined when the caller omitted it; throws ValidationError on anything
 * that fails to parse as a date, instead of letting it reach a raw SQL
 * ::date/::timestamptz cast as an invalid literal.
 */
export function parseDateParam(value: unknown, paramName: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${paramName} must be a valid date`);
  }
  return value;
}
