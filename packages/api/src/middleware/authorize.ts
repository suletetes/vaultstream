/**
 * Authorization Middleware
 *
 * Enforces resource-level access control for file operations.
 * Checks ownership first, then falls back to share-based permissions.
 * Permission hierarchy: view < download < edit.
 */

import { Request, Response, NextFunction } from 'express';
import { Permission, FileEntity, ShareEntity, AppError, ErrorCode } from '@vaultstream/shared';
import { getItem, userPK, fileSK, sharePK, shareSK } from '../db';

// ─── Permission Levels ──────────────────────────────────────────────────────

const PERMISSION_LEVELS: Record<Permission, number> = {
  view: 1,
  download: 2,
  edit: 3,
};

/**
 * Check if a user's permission level is sufficient for the required permission.
 * Permission hierarchy: view (1) < download (2) < edit (3).
 */
export function hasPermission(userPerm: Permission, required: Permission): boolean {
  return PERMISSION_LEVELS[userPerm] >= PERMISSION_LEVELS[required];
}

// ─── Middleware Factory ─────────────────────────────────────────────────────

/**
 * Express middleware factory that enforces file-level authorization.
 *
 * Flow:
 * 1. Extract userId from req.user and fileId from req.params.id
 * 2. Check ownership: getItem(userPK(userId), fileSK(fileId))
 * 3. If owner → attach file to req.fileMetadata, call next()
 * 4. If not owner → check share: getItem(sharePK(fileId), shareSK(userId))
 * 5. Verify permission hierarchy and expiration
 * 6. If sufficient permission → attach file and share to req, call next()
 * 7. If no access → throw FORBIDDEN (403)
 */
export function authorizeFileAccess(requiredPermission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const fileId = req.params.id;

      if (!userId) {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Authentication required',
        });
      }

      if (!fileId) {
        throw new AppError({
          code: ErrorCode.FORBIDDEN,
          message: 'Access denied',
        });
      }

      // Check ownership
      const file = await getItem<FileEntity>(userPK(userId), fileSK(fileId));

      if (file) {
        // Owner has full access
        req.fileMetadata = file;
        next();
        return;
      }

      // Not owner — check for a share record
      const share = await getItem<ShareEntity>(sharePK(fileId), shareSK(userId));

      if (!share) {
        // No ownership or share — deny without revealing file existence
        throw new AppError({
          code: ErrorCode.FORBIDDEN,
          message: 'Access denied',
        });
      }

      // Check expiration
      if (share.expiresAt && share.expiresAt < Math.floor(Date.now() / 1000)) {
        throw new AppError({
          code: ErrorCode.FORBIDDEN,
          message: 'Access denied',
        });
      }

      // Check permission hierarchy
      if (!hasPermission(share.permissions, requiredPermission)) {
        throw new AppError({
          code: ErrorCode.FORBIDDEN,
          message: 'Access denied',
        });
      }

      // Sufficient permission — fetch the file for downstream handlers
      const ownerFile = await getItem<FileEntity>(
        `USER#${share.sharedBy}` as `USER#${string}`,
        fileSK(fileId),
      );

      if (!ownerFile) {
        throw new AppError({
          code: ErrorCode.FORBIDDEN,
          message: 'Access denied',
        });
      }

      req.fileMetadata = ownerFile;
      req.share = share;
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }

      next(
        new AppError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'An unexpected error occurred',
        }),
      );
    }
  };
}
