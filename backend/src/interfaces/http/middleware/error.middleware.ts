/**
 * Global Error Handler Middleware
 * Converts all errors to structured JSON API responses.
 */
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Schema validation failures are client errors, not server faults
  if (err instanceof ZodError) {
    res.status(400).json({
      code:    'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      code:    err.code,
      message: err.message,
      details: err.details ?? undefined,
    });
    return;
  }

  // CF-QA-07: a malformed JSON request body (express.json()'s underlying
  // body-parser) throws a plain SyntaxError — not a ZodError or AppError —
  // that already carries `.status/.statusCode = 400` and `.expose = true`
  // (verified directly against the installed body-parser: `type` is set to
  // the literal string 'entity.parse.failed' ONLY for this exact failure
  // mode). Without this branch it fell through to the generic 500 below: a
  // clean client input error surfacing as a server fault. Checking the
  // specific `type` string (rather than trusting any error's `.statusCode`)
  // keeps this narrow — a genuine bug that happens to set an unrelated
  // `.statusCode` property must still surface as a 500, per the "don't
  // globally map errors to 400" rule.
  if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({
      code:    'VALIDATION_ERROR',
      message: 'Request body is not valid JSON',
    });
    return;
  }

  // Unexpected / programming errors
  logger.error(
    { err, path: req.path, method: req.method },
    'Unhandled exception'
  );

  res.status(500).json({
    code:    'INTERNAL_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
  });
}
