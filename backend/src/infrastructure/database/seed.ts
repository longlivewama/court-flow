import 'dotenv/config';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { db } from './client';
import { hashPassword } from '../auth/argon2.service';
import { logger } from '../../shared/logger';

const DEFAULT_OWNER_EMAIL    = 'admin@courtflow.com';
const DEFAULT_OWNER_PASSWORD = 'Admin@123456';

/**
 * Dev-only convenience: ensures a default owner account exists so local
 * testing doesn't require registering + manually patching roles.
 * Called from index.ts on bootstrap; never runs in production.
 */
export async function seedDefaultOwner(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;

  const clubId = process.env.CLUB_ID;
  if (!clubId) return;

  const { rows: existing } = await db.query(
    `SELECT id FROM users WHERE club_id=$1 AND email=$2`,
    [clubId, DEFAULT_OWNER_EMAIL]
  );
  if (existing.length) return;

  const passwordHash = await hashPassword(DEFAULT_OWNER_PASSWORD);

  await db.query(
    `INSERT INTO users (id,club_id,email,password_hash,role,first_name,last_name,email_verified)
     VALUES ($1,$2,$3,$4,'owner',$5,$6,TRUE)`,
    [uuidv4(), clubId, DEFAULT_OWNER_EMAIL, passwordHash, 'Default', 'Owner']
  );

  logger.warn(
    `[seed] Created default dev owner account — email: ${DEFAULT_OWNER_EMAIL}, password: ${DEFAULT_OWNER_PASSWORD}. ` +
    `This only runs outside NODE_ENV=production.`
  );
}

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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
