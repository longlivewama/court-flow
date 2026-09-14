/**
 * Shared pagination/date query-param validation (Phase 11).
 *
 * audit/booking/payment list endpoints used to do `parseInt(page)` with no
 * validation, binding the result straight into SQL LIMIT/OFFSET — a
 * non-numeric value produced NaN, which node-pg serializes as the literal
 * string "NaN", which Postgres then rejects with a raw, unhandled error
 * (500) instead of a clean 400. Malformed `from`/`to` date strings hit the
 * same failure mode against a ::date/timestamptz comparison.
 */
import { parsePagination, parseDateParam } from '../src/shared/query-params';
import { ValidationError } from '../src/shared/errors';

describe('parsePagination', () => {
  test('defaults to page 1 and the caller-supplied default limit when omitted', () => {
    expect(parsePagination({}, { limit: 20 })).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  test('computes the correct offset for page > 1', () => {
    expect(parsePagination({ page: '3', limit: '10' }, { limit: 20 })).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  test.each(['abc', 'NaN', '1.5', '-1', '0', '', ' '])('rejects an invalid page value %p', (page) => {
    expect(() => parsePagination({ page }, { limit: 20 })).toThrow(ValidationError);
  });

  test.each(['abc', 'NaN', '2.5', '-5', '0'])('rejects an invalid limit value %p', (limit) => {
    expect(() => parsePagination({ limit }, { limit: 20 })).toThrow(ValidationError);
  });

  test('rejects a limit above the configured maximum', () => {
    expect(() => parsePagination({ limit: '5000' }, { limit: 20, maxLimit: 200 })).toThrow(ValidationError);
  });

  test('accepts a limit exactly at the maximum', () => {
    expect(parsePagination({ limit: '200' }, { limit: 20, maxLimit: 200 }).limit).toBe(200);
  });
});

describe('parseDateParam', () => {
  test('returns undefined when the value is absent, null, or empty', () => {
    expect(parseDateParam(undefined, 'from')).toBeUndefined();
    expect(parseDateParam(null, 'from')).toBeUndefined();
    expect(parseDateParam('', 'from')).toBeUndefined();
  });

  test('passes through a well-formed ISO date/timestamp unchanged', () => {
    expect(parseDateParam('2026-09-15', 'from')).toBe('2026-09-15');
    expect(parseDateParam('2026-09-15T10:00:00.000Z', 'from')).toBe('2026-09-15T10:00:00.000Z');
  });

  test('rejects a non-date string instead of letting it reach a SQL cast', () => {
    expect(() => parseDateParam('not-a-date', 'from')).toThrow(ValidationError);
  });

  test('rejects a non-string value (e.g. an array from a repeated query key)', () => {
    expect(() => parseDateParam(['2026-09-15', '2026-09-16'], 'from')).toThrow(ValidationError);
  });
});
