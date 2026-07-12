/**
 * JWT service: RSA-2048 signed access tokens (15m) + refresh tokens (7d).
 *
 * Key loading strategy:
 *  1. Try to read PEM files from JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH
 *     (or the default ./keys/*.pem paths).
 *  2. If the files are missing and NODE_ENV !== 'production', generate an
 *     ephemeral RSA-2048 key pair in memory so dev/Docker environments can
 *     still exercise auth flows without pre-provisioned keys.
 *  3. If the files are missing in production, throw a descriptive fatal error
 *     immediately rather than crashing with a cryptic ENOENT later.
 */
import * as jwt from 'jsonwebtoken';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger';

interface KeyPair {
  privateKey: Buffer;
  publicKey:  Buffer;
}

/** Lazily-initialised key pair (real files or ephemeral fallback). */
let _keys: KeyPair | null = null;

function loadKeys(): KeyPair {
  if (_keys) return _keys;

  const privatePath = process.env.JWT_PRIVATE_KEY_PATH ?? './keys/private.pem';
  const publicPath  = process.env.JWT_PUBLIC_KEY_PATH  ?? './keys/public.pem';

  try {
    _keys = {
      privateKey: fs.readFileSync(privatePath),
      publicKey:  fs.readFileSync(publicPath),
    };
    return _keys;
  } catch (err: unknown) {
    const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT';

    // In production, missing keys are a fatal misconfiguration.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[jwt.service] Cannot load RSA keys in production. ` +
        `Set JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH or mount the key files. ` +
        `Original error: ${(err as Error).message}`
      );
    }

    // In development/test, warn and generate an ephemeral RSA-2048 pair so
    // auth flows work without pre-provisioned keys.
    if (isEnoent) {
      logger.warn(
        { privatePath, publicPath },
        '[jwt.service] Key files not found — generating an ephemeral RSA-2048 pair for this process. Tokens will NOT survive a restart.'
      );
    } else {
      logger.warn(
        { err },
        '[jwt.service] Unexpected error reading key files, falling back to ephemeral RSA pair'
      );
    }

    const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync('rsa', {
      modulusLength:  2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    _keys = {
      privateKey: Buffer.from(priv),
      publicKey:  Buffer.from(pub),
    };
    return _keys;
  }
}

function privateKey(): Buffer { return loadKeys().privateKey; }
function publicKey():  Buffer { return loadKeys().publicKey; }

export interface JwtPayload {
  sub:    string;
  email:  string;
  role:   string;
  clubId: string;
  jti:    string;
  iat?:   number;
  exp?:   number;
}

export function signAccessToken(payload: Omit<JwtPayload, 'jti'>): string {
  const jti = uuidv4();
  return jwt.sign({ ...payload, jti }, privateKey(), {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer:    'courtflow',
    audience:  'courtflow-client',
  });
}

export function signRefreshToken(payload: Omit<JwtPayload, 'jti'>): { token: string; jti: string } {
  const jti = uuidv4();
  const token = jwt.sign({ ...payload, jti }, privateKey(), {
    algorithm: 'RS256',
    expiresIn: '7d',
    issuer:    'courtflow',
    audience:  'courtflow-refresh',
  });
  return { token, jti };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, publicKey(), {
    algorithms: ['RS256'],
    issuer:     'courtflow',
    audience:   'courtflow-client',
  }) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, publicKey(), {
    algorithms: ['RS256'],
    issuer:     'courtflow',
    audience:   'courtflow-refresh',
  }) as JwtPayload;
}

export function decodeTokenUnsafe(token: string): JwtPayload | null {
  return jwt.decode(token) as JwtPayload | null;
}
