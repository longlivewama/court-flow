/**
 * Regression test for the rate-limiter Redis keyspace bug found while adding
 * the forgot/reset-password limiters: express-rate-limit's default
 * keyGenerator returns only `req.ip`, so every limiter built by the
 * rateLimiter() factory in auth.middleware.ts used to share the literal
 * Redis prefix "rl:" — meaning hitting /login would also burn down
 * /forgot-password's (or /register's, /upload's, ...) quota for the same
 * client IP, and vice versa. Each limiter must now write to its own
 * namespaced prefix.
 */
const capturedPrefixes: string[] = [];

jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { call: jest.fn() },
  CACHE_KEYS: { tokenRevoked: (id: string) => `token:revoked:${id}` },
  CACHE_TTL: {},
}));

jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation((opts: { prefix?: string }) => {
    capturedPrefixes.push(opts.prefix ?? '');
    return {
      prefix: opts.prefix,
      increment: jest.fn(),
      decrement: jest.fn(),
      resetKey: jest.fn(),
    };
  }),
}));

import * as authMiddleware from '../src/interfaces/http/middleware/auth.middleware';

describe('rate limiter Redis keyspace isolation', () => {
  test('every pre-configured limiter is a valid middleware', () => {
    expect(typeof authMiddleware.loginLimiter).toBe('function');
    expect(typeof authMiddleware.forgotPasswordLimiter).toBe('function');
    expect(typeof authMiddleware.passwordLimiter).toBe('function');
  });

  test('each limiter got its own Redis prefix — none share the bare "rl:" prefix', () => {
    // Module-level consts mean importing the module above already constructed
    // every limiter exactly once, so capturedPrefixes holds one entry each.
    expect(capturedPrefixes.length).toBeGreaterThanOrEqual(8);
    expect(capturedPrefixes.every((p) => p !== 'rl:')).toBe(true);
    expect(new Set(capturedPrefixes).size).toBe(capturedPrefixes.length);
  });

  test('forgot-password is namespaced separately from password-reset, login, and register', () => {
    expect(capturedPrefixes).toEqual(
      expect.arrayContaining(['rl:login:', 'rl:register:', 'rl:password-reset:', 'rl:forgot-password:'])
    );
  });
});
