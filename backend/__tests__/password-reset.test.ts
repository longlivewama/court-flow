/**
 * Password reset flow — forgotPassword / resetPassword controllers.
 *
 * The DB client, email service, and audit sink are mocked so the suite runs
 * offline and asserts on the SQL/behavior the controllers produce, mirroring
 * the style of create-subscription.usecase.test.ts.
 */
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../src/shared/errors';

// ── Mocks ──────────────────────────────────────────────────────
jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { call: jest.fn(), get: jest.fn(), setex: jest.fn() },
  CACHE_KEYS: { tokenRevoked: (id: string) => `token:revoked:${id}` },
  CACHE_TTL: {},
}));
jest.mock('../src/infrastructure/auth/argon2.service', () => ({
  hashPassword: jest.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: jest.fn(),
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: { sendPasswordReset: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
    USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  },
}));

import { forgotPassword, resetPassword } from '../src/interfaces/http/controllers/auth.controller';
import { db, withTransaction } from '../src/infrastructure/database/client';
import { hashPassword } from '../src/infrastructure/auth/argon2.service';
import { emailService } from '../src/infrastructure/email/email.service';
import { auditLog } from '../src/infrastructure/audit/audit.service';

interface RecordedCall { text: string; params: unknown[]; }

/** Lets the fire-and-forget token-issuance chain (forgotPassword doesn't await it) settle. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeReq(body: unknown): Request {
  return { body, ip: '203.0.113.9', headers: { 'user-agent': 'jest' } } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; statusCode: number } {
  const res = {} as Response & { body?: unknown; statusCode: number };
  res.statusCode = 200;
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════
// forgotPassword
// ══════════════════════════════════════════════════════════════
describe('forgotPassword', () => {
  test('unknown email still returns the generic message and issues no token', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ email: 'nobody@example.com' });
    const res = makeRes();
    const next = jest.fn();

    await forgotPassword(req, res, next as NextFunction);
    await flushAsync();

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
    // Only the lookup ran — no DELETE/INSERT into password_resets for a non-match.
    expect((db.query as jest.Mock).mock.calls).toHaveLength(1);
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  test('known email returns the same generic message immediately and issues a token asynchronously', async () => {
    const calls: RecordedCall[] = [];
    (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/SELECT id, club_id, first_name, email, role FROM users/i.test(text)) {
        return { rows: [{ id: 'user-1', club_id: 'club-1', first_name: 'Nour', email: 'nour@example.com', role: 'customer' }] };
      }
      return { rows: [] };
    });

    const req = makeReq({ email: 'NOUR@Example.com' }); // zod lowercases + trims
    const res = makeRes();
    const next = jest.fn();

    await forgotPassword(req, res, next as NextFunction);

    // The response must not wait on token issuance / email delivery.
    expect(res.json).toHaveBeenCalledWith({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });

    await flushAsync();

    expect(calls.some((c) => /SELECT id, club_id, first_name, email, role FROM users/i.test(c.text)
      && /is_active = TRUE/i.test(c.text))).toBe(true);
    expect(calls.some((c) => /DELETE FROM password_resets WHERE user_id = \$1 AND used_at IS NULL/i.test(c.text)
      && c.params[0] === 'user-1')).toBe(true);
    expect(calls.some((c) => /INSERT INTO password_resets/i.test(c.text) && c.params[0] === 'user-1')).toBe(true);
    expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'nour@example.com', firstName: 'Nour' })
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'PASSWORD_RESET_REQUESTED', userId: 'user-1', clubId: 'club-1' })
    );
  });

  test('malformed input (invalid email) is rejected before touching the database', async () => {
    const req = makeReq({ email: 'not-an-email' });
    const res = makeRes();
    const next = jest.fn();

    await forgotPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(res.json).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a failure issuing the token is swallowed, never surfaced to the caller', async () => {
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (/SELECT id, club_id, first_name, email, role FROM users/i.test(text)) {
        return { rows: [{ id: 'user-1', club_id: 'club-1', first_name: 'Nour', email: 'nour@example.com', role: 'customer' }] };
      }
      throw new Error('db unavailable');
    });

    const req = makeReq({ email: 'nour@example.com' });
    const res = makeRes();
    const next = jest.fn();

    await forgotPassword(req, res, next as NextFunction);
    await flushAsync();

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('If an account exists') })
    );
  });
});

// ══════════════════════════════════════════════════════════════
// resetPassword
// ══════════════════════════════════════════════════════════════
describe('resetPassword', () => {
  function futureDate(hours = 1) { return new Date(Date.now() + hours * 3_600_000); }
  function pastDate(hours = 1) { return new Date(Date.now() - hours * 3_600_000); }

  function mockValidTokenLookup(overrides: Partial<{ used_at: Date | null; expires_at: Date }> = {}) {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{
        id: 'reset-1', user_id: 'user-1', club_id: 'club-1', role: 'customer',
        expires_at: futureDate(), used_at: null,
        ...overrides,
      }],
    });
  }

  function wireTransaction(client: { query: jest.Mock }) {
    (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
  }

  test('valid reset: hashes the password, marks the token used, and revokes sessions', async () => {
    mockValidTokenLookup();

    const calls: RecordedCall[] = [];
    const client = {
      query: jest.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (/UPDATE password_resets SET used_at = NOW\(\)/i.test(text)) return { rowCount: 1 };
        return { rowCount: 1, rows: [] };
      }),
    };
    wireTransaction(client);

    const req = makeReq({ token: 'raw-token-value', password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledWith('NewPass123');

    const usedAtCall = calls.find((c) => /UPDATE password_resets SET used_at = NOW\(\)/i.test(c.text));
    expect(usedAtCall?.params).toEqual(['reset-1']);

    const passwordUpdateCall = calls.find((c) => /UPDATE users SET password_hash/i.test(c.text));
    expect(passwordUpdateCall?.params).toEqual(['$argon2id$hashed', 'user-1']);

    const revokeCall = calls.find((c) => /UPDATE refresh_tokens SET revoked_at = NOW\(\)/i.test(c.text));
    expect(revokeCall?.params).toEqual(['user-1']);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'USER_PASSWORD_RESET', userId: 'user-1' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('unknown/invalid token is rejected as a clean 400, never a 500', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ token: 'does-not-exist', password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(withTransaction).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('expired token is rejected', async () => {
    mockValidTokenLookup({ expires_at: pastDate() });

    const req = makeReq({ token: 'raw-token-value', password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('already-used (reused) token is rejected', async () => {
    mockValidTokenLookup({ used_at: pastDate(2) });

    const req = makeReq({ token: 'raw-token-value', password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('concurrent redemption race: loser sees rowCount 0 and rolls back without touching the password', async () => {
    mockValidTokenLookup(); // passes the pre-transaction check…

    const calls: RecordedCall[] = [];
    const client = {
      query: jest.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        // …but by the time this request's transaction runs, a concurrent
        // request already consumed the token.
        if (/UPDATE password_resets SET used_at = NOW\(\)/i.test(text)) return { rowCount: 0 };
        return { rowCount: 1, rows: [] };
      }),
    };
    wireTransaction(client);

    const req = makeReq({ token: 'raw-token-value', password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(calls.some((c) => /UPDATE users SET password_hash/i.test(c.text))).toBe(false);
    expect(calls.some((c) => /UPDATE refresh_tokens/i.test(c.text))).toBe(false);
  });

  test('malformed input (weak password) is rejected before any DB lookup', async () => {
    const req = makeReq({ token: 'raw-token-value', password: 'short' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('malformed input (missing token) is rejected before any DB lookup', async () => {
    const req = makeReq({ password: 'NewPass123' });
    const res = makeRes();
    const next = jest.fn();

    await resetPassword(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });
});
