/**
 * CF-QA-07 (MEDIUM) — a malformed JSON request body surfaced as a 500
 * instead of a clean 400. express.json()'s underlying body-parser throws a
 * plain SyntaxError (not a ZodError, not an AppError) that already carries
 * `.status/.statusCode = 400` and `.expose = true`, with `.type` set to the
 * literal 'entity.parse.failed' — verified directly against the installed
 * body-parser (see the fix's own comment for the exact shape captured).
 * globalErrorHandler only special-cased ZodError/AppError, so this fell
 * through to the generic 500 branch.
 *
 * The fix checks the specific `type` string rather than trusting any
 * error's `.statusCode` blindly — this suite locks that narrowness in too,
 * so a genuine bug that happens to carry an unrelated `.statusCode`
 * property still surfaces as a 500.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { globalErrorHandler } from '../src/interfaces/http/middleware/error.middleware';
import { ValidationError, NotFoundError } from '../src/shared/errors';

jest.mock('../src/shared/logger', () => ({
  logger: { error: jest.fn() },
}));

function makeReq(): Request {
  return { path: '/api/courts', method: 'POST' } as unknown as Request;
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

/** Mirrors exactly what body-parser attaches to the SyntaxError it throws. */
function bodyParserSyntaxError(message = "Expected property name or '}' in JSON at position 1"): SyntaxError {
  const err = new SyntaxError(message) as SyntaxError & { status: number; statusCode: number; expose: boolean; type: string; body: string };
  err.status = 400;
  err.statusCode = 400;
  err.expose = true;
  err.type = 'entity.parse.failed';
  err.body = '{not valid json!!';
  return err;
}

describe('globalErrorHandler — malformed JSON body (CF-QA-07)', () => {
  test('a body-parser JSON syntax error → clean 400, not 500', () => {
    const res = makeRes();
    globalErrorHandler(bodyParserSyntaxError(), makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  test('the raw request body is never echoed back in the response (no leak of attacker-controlled input)', () => {
    const res = makeRes();
    globalErrorHandler(bodyParserSyntaxError(), makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(JSON.stringify(res.body)).not.toMatch(/not valid json/);
  });

  test('a plain SyntaxError WITHOUT the body-parser type marker still falls through to 500 (narrow check, not "any SyntaxError")', () => {
    const res = makeRes();
    const plainSyntaxError = new SyntaxError('some unrelated syntax error in application code');
    globalErrorHandler(plainSyntaxError, makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(500);
  });

  test('an unrelated error that merely happens to carry a .statusCode property is NOT reclassified as 400 (guards against over-broadening the fix)', () => {
    const res = makeRes();
    const impostor = new Error('totally unrelated bug') as Error & { statusCode: number };
    impostor.statusCode = 400; // no `.type` marker — must NOT be treated as the JSON-parse case
    globalErrorHandler(impostor, makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(500);
  });

  test('ZodError still maps to 400 exactly as before (unaffected)', () => {
    const res = makeRes();
    const zerr = new ZodError([{ code: 'custom', path: ['email'], message: 'Invalid' }]);
    globalErrorHandler(zerr, makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  test('AppError still maps to its own statusCode exactly as before (unaffected)', () => {
    const res = makeRes();
    globalErrorHandler(new NotFoundError('Booking', 'b-1'), makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(404);
  });

  test('ValidationError (AppError subclass) still maps to 400 exactly as before (unaffected)', () => {
    const res = makeRes();
    globalErrorHandler(new ValidationError('bad input'), makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(400);
  });

  test('a genuine unexpected error (e.g. a real programming bug) still surfaces as 500 with no stack trace in the response', () => {
    const res = makeRes();
    globalErrorHandler(new TypeError("Cannot read properties of undefined (reading 'foo')"), makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/Cannot read properties/);
  });
});
