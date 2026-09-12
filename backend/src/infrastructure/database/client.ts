import { Pool, PoolClient, QueryResultRow } from 'pg';
import { logger } from '../../shared/logger';

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
