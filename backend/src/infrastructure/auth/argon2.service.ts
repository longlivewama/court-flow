/**
 * Password hashing service using Argon2id (primary) with bcrypt fallback.
 * Parameters follow SRS §15: memory=64MiB, iterations=3, parallelism=2.
 */
import bcrypt from 'bcrypt';
import { logger } from '../../shared/logger';

// Argon2id parameters (SRS §15 compliant)
const ARGON2_OPTIONS = {
  memoryCost: 65536,   // 64 MiB
  timeCost:   3,       // iterations
  parallelism: 2,
};

let argon2: typeof import('@node-rs/argon2') | null = null;

async function getArgon2() {
  if (!argon2) {
    try {
      argon2 = await import('@node-rs/argon2');
    } catch {
      logger.warn('Argon2 not available; falling back to bcrypt');
    }
  }
  return argon2;
}

export async function hashPassword(password: string): Promise<string> {
  const a2 = await getArgon2();
  if (a2) {
    return a2.hash(password, ARGON2_OPTIONS);
  }
  // bcrypt fallback – cost factor 12
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  // Detect hash algorithm by prefix
  if (hash.startsWith('$argon2')) {
    const a2 = await getArgon2();
    if (a2) {
      return a2.verify(hash, password);
    }
  }
  if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
    return bcrypt.compare(password, hash);
  }
  throw new Error('Unknown password hash format');
}
