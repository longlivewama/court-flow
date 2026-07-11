/**
 * Global Error Handler Middleware
 * Converts all errors to structured JSON API responses.
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
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
