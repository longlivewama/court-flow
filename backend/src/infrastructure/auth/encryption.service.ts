/**
 * AES-256-GCM file encryption service for payment receipts.
 * Per-file random 12-byte IV; key sourced from environment (KMS-ready).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;     // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) throw new Error('ENCRYPTION_KEY environment variable is not set');
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return key;
}

export interface EncryptedFile {
  storageKey: string;    // path on disk (relative to UPLOAD_DIR)
  encryptionIv: string;  // base64 IV
}

/**
 * Encrypt a file buffer and write it to the upload directory.
 * Returns the storage key and IV needed for later decryption.
 */
export async function encryptAndStore(
  fileBuffer: Buffer,
  originalName: string
): Promise<EncryptedFile> {
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  fs.mkdirSync(uploadDir, { recursive: true });

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  }) as crypto.CipherGCM;

  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([authTag, encrypted]); // prepend auth tag

  const storageKey = `${crypto.randomUUID()}-${Date.now()}${path.extname(originalName)}.enc`;
  const filePath = path.join(uploadDir, storageKey);
  fs.writeFileSync(filePath, payload);

  return {
    storageKey,
    encryptionIv: iv.toString('base64'),
  };
}

/**
 * Decrypt a stored encrypted file and return the plaintext buffer.
 */
export function decryptFile(storageKey: string, encryptionIv: string): Buffer {
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  const filePath = path.join(uploadDir, storageKey);
  const payload = fs.readFileSync(filePath);

  const authTag = payload.subarray(0, AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(AUTH_TAG_LENGTH);

  const iv = Buffer.from(encryptionIv, 'base64');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  }) as crypto.DecipherGCM;
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
