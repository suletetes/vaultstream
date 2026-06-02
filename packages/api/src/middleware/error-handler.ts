/**
 * Global Error Handler Middleware
 *
 * Catches all errors and returns a consistent JSON error response.
 * - AppError instances are serialized using their toResponse method.
 * - Unknown errors are returned as INTERNAL_ERROR (500) without exposing internals.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode, ERROR_STATUS_CODES } from '@vaultstream/shared';
import type { ErrorResponse } from '@vaultstream/shared';

/**
 * Express error-handling middleware (4-argument signature).
 */
export function errorHandler() {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';

    if (err instanceof AppError) {
      const response: ErrorResponse = err.toResponse(requestId);
      res.status(err.statusCode).json(response);
      return;
    }

    // Unknown errors — do not expose stack traces or internal details
    const statusCode = ERROR_STATUS_CODES[ErrorCode.INTERNAL_ERROR];
    const response: ErrorResponse = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        statusCode,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(statusCode).json(response);
  };
}
