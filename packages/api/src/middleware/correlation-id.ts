/**
 * Correlation ID Middleware
 *
 * Generates or propagates X-Request-Id header for request tracing.
 * If the incoming request has an X-Request-Id header, it is propagated.
 * Otherwise, a new UUID v4 is generated using Node.js crypto module.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Middleware that ensures every request has a correlation ID.
 * The ID is attached to the request object and set on the response header.
 */
export function correlationId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const existingId = req.headers[REQUEST_ID_HEADER] as string | undefined;
    const requestId = existingId || randomUUID();

    // Attach to request for downstream use
    req.requestId = requestId;

    // Set on response header for client correlation
    res.setHeader('X-Request-Id', requestId);

    next();
  };
}
