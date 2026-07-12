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
