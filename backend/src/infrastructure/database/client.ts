import { Pool, PoolClient, QueryResultRow, QueryResult } from 'pg';
import { logger } from '../../shared/logger';
import { getTenantContext } from '../../shared/tenant-context';

/**
 * Applies the active tenant context (see tenant-context.ts) to `client` via
 * `SET LOCAL` — actually `set_config(..., true)`, the parameterized
 * equivalent, since `SET LOCAL x = $1` isn't valid SQL. Scoped to the
 * current transaction only; automatically discarded at COMMIT/ROLLBACK.
 * `runAsSystem()` contexts (clubId: null) deliberately set nothing, so RLS
 * policies see no tenant and fall through to their system-bypass branch.
 */
async function applyTenantContext(client: PoolClient): Promise<void> {
  const ctx = getTenantContext();
  if (ctx?.clubId) {
    await client.query(`SELECT set_config('app.current_club_id', $1, true)`, [ctx.clubId]);
  }
}

function resolveSsl(connectionString?: string) {
  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const connectionDisablesSsl = connectionString?.includes('sslmode=disable') ?? false;

  if (process.env.NODE_ENV === 'development' || sslMode === 'disable' || connectionDisablesSsl) {
    return false;
  }

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false;
}

// ── Primary connection pool (day-to-day app access) ───────────
// DATABASE_URL_APP is the non-superuser `courtflow_app` role introduced in
// migration 018 (see its header comment): it has full read-write access to
// every table except audit_logs, where it can only SELECT — never
// UPDATE/DELETE/TRUNCATE. Falls back to DATABASE_URL (the migrations/admin
// role) when unset, so any environment that hasn't provisioned the new role
// yet — or the migration runner itself — keeps working unchanged.
const APP_DATABASE_URL = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;

export const db = new Pool({
  connectionString: APP_DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: resolveSsl(APP_DATABASE_URL),
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

// ── Audit-only connection pool (INSERT-only role) ─────────────
export const auditDb = new Pool({
  connectionString: process.env.DATABASE_URL_AUDIT ?? process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: resolveSsl(process.env.DATABASE_URL_AUDIT ?? process.env.DATABASE_URL),
});

/**
 * Execute a function within a serializable database transaction.
 * Acquires a client from the pool and automatically commits/rolls back.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await applyTenantContext(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a single query with automatic connection management.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await db.query<T>(text, params as unknown[]);
  return rows;
}

// ── Tenant-scoped single-shot queries (CF-QA-005) ─────────────
// db.query() (a plain pg.Pool method) auto-commits each statement on
// whichever pooled connection happens to be free — there's no window to
// attach a transaction-scoped `SET LOCAL` to it. The ~150 call sites across
// the codebase all use the same `await db.query<T>(text, params)` shape
// (verified by inspection — none use the callback or QueryConfig-object
// overloads), so rather than thread tenant context through every call site,
// wrap Pool.query itself: when a tenant is active, transparently promote the
// single statement into its own short transaction (BEGIN; set_config;
// <query>; COMMIT) so RLS's session-variable check sees it, exactly as
// withTransaction() does above. Outside any tenant context (migrations,
// seed scripts, the pre-auth parts of a request) this is a no-op passthrough
// — zero behavior change, zero overhead.
const rawPoolQuery = db.query.bind(db);
(db as unknown as { query: typeof db.query }).query = (async (
  text: unknown,
  params?: unknown
): Promise<QueryResult> => {
  const ctx = getTenantContext();
  if (!ctx?.clubId || typeof text !== 'string') {
    return rawPoolQuery(text as string, params as unknown[]);
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await applyTenantContext(client);
    const result = await client.query(text, params as unknown[]);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}) as typeof db.query;
