/**
 * Route parameter extraction utilities.
 *
 * Express types req.params values as string | undefined, but when a route
 * matches, the params are guaranteed to exist. These helpers provide safe
 * extraction with proper typing.
 */

import { Request } from 'express';
import { AppError, ErrorCode } from '@vaultstream/shared';

/**
 * Extract a required route parameter. Throws 400 if missing.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) {
    throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `Missing required parameter: ${name}` });
  }
  return value;
}

/**
 * Extract userId from authenticated request. Throws 401 if missing.
 */
export function requireUserId(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError({ code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' });
  }
  return userId;
}

/**
 * Extract user tier from authenticated request, defaults to 'free'.
 */
export function getUserTier(req: Request): string {
  return req.user?.tier || 'free';
}

/**
 * Extract user role from authenticated request, defaults to 'user'.
 */
export function getUserRole(req: Request): string {
  return req.user?.role || 'user';
}
