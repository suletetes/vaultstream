/**
 * Zod Validation Middleware
 *
 * Generic request validation middleware using Zod schemas.
 * Validates body, query, and/or params against provided schemas.
 *
 * Returns HTTP 400 with VALIDATION_ERROR code and field-level details on failure.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError, ErrorCode } from '@vaultstream/shared';
import type { ValidationDetail } from '@vaultstream/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

// ─── Middleware Factory ─────────────────────────────────────────────────────

/**
 * Factory function that creates validation middleware for Express routes.
 *
 * @param schemas - Object containing optional Zod schemas for body, query, and params
 * @returns Express middleware that validates the request against the provided schemas
 *
 * @example
 * ```typescript
 * router.post('/files/upload-url',
 *   validate({ body: uploadUrlSchema }),
 *   fileController.generateUploadUrl
 * );
 * ```
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const details: ValidationDetail[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        details.push(...mapZodErrors(result.error, 'body'));
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        details.push(...mapZodErrors(result.error, 'query'));
      } else {
        req.query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        details.push(...mapZodErrors(result.error, 'params'));
      } else {
        req.params = result.data;
      }
    }

    if (details.length > 0) {
      next(
        new AppError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request validation failed',
          details,
        })
      );
      return;
    }

    next();
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Maps Zod validation errors to the VaultStream ValidationDetail format.
 */
function mapZodErrors(error: ZodError, source: 'body' | 'query' | 'params'): ValidationDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : source;
    const field = source === 'body' ? path : `${source}.${path}`;

    return {
      field,
      message: issue.message,
      code: issue.code,
    };
  });
}
