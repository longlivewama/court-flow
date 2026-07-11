import 'dotenv/config';
import { Pool } from 'pg';

function resolveSsl(connectionString?: string) {
  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const connectionDisablesSsl = connectionString?.includes('sslmode=disable') ?? false;

  if (process.env.NODE_ENV === 'development' || sslMode === 'disable' || connectionDisablesSsl) {
    return false;
  }

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const clubId = process.env.CLUB_ID ?? '00000000-0000-0000-0000-000000000001';

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
  });

  try {
    await pool.query(
      `INSERT INTO clubs (id, name, timezone, currency)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           timezone = EXCLUDED.timezone,
           currency = EXCLUDED.currency,
           updated_at = NOW()`,
      [clubId, 'CourtFlow Padel Club', 'Africa/Cairo', 'EGP']
    );

    console.log(`Seed complete: ensured club ${clubId}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
