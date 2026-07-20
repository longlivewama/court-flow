/**
 * SQL migration runner.
 *
 * Applies every `backend/migrations/*.sql` file, in lexical (numeric-prefix)
 * order, exactly once against DATABASE_URL. Applied files are recorded in a
 * `schema_migrations` bookkeeping table so re-running is a safe no-op.
 *
 * Relationship to Docker: docker-compose mounts ./backend/migrations into
 * Postgres's /docker-entrypoint-initdb.d, so a FRESH `docker compose up`
 * volume applies these automatically on first boot. This runner is the
 * equivalent path for non-Docker local dev and CI (a fresh database), and the
 * programmatic way to apply any newly-added migration to an existing tracked
 * database. Individual migration files are not written to be idempotent, so
 * this runner must only be pointed at a database whose applied migrations it
 * has actually recorded (a fresh DB, or one it has managed from the start).
 *
 * Usage: `npm run migrate`
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

function resolveSsl(connectionString?: string) {
  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const connectionDisablesSsl = connectionString?.includes('sslmode=disable') ?? false;

  if (process.env.NODE_ENV === 'development' || sslMode === 'disable' || connectionDisablesSsl) {
    return false;
  }
  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  // __dirname resolves to <root>/src/infrastructure/database (ts-node) or
  // <root>/dist/infrastructure/database (compiled) — both are three levels
  // below the backend root, where the migrations/ directory lives.
  const migrationsDir = path.resolve(__dirname, '../../../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log(`No .sql migrations found in ${migrationsDir}`);
    return;
  }

  const pool = new Pool({ connectionString, ssl: resolveSsl(connectionString) });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations`
    );
    const applied = new Set(rows.map((r) => r.filename));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`apply  ${file}`);

      // Each file runs in its own transaction so a failure never leaves a
      // migration half-applied. (Postgres 12+ permits ALTER TYPE ... ADD VALUE
      // inside a transaction, which migrations 009/012 rely on.)
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }

    console.log(ran === 0 ? 'Migrations up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
