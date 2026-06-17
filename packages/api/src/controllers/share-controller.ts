/**
 * ShareController — Express route handlers for file sharing operations.
 *
 * Handles:
 * - createShare: Share a file with another user
 * - listShares: List all shares for a file
 * - updateShare: Update share permissions
 * - revokeShare: Revoke a share
 * - sharedWithMe: List files shared with the current user
 *
 * Validates: Requirements 4.1, 4.6, 4.7, 4.10
 */

import { Request, Response, NextFunction } from 'express';
import { shareService } from '../services/share-service';

/**
 * POST /api/files/:id/share
 *
 * Creates a share for a file with a target user.
 * Request body validated by createShareSchema middleware.
 * Returns 201 with the created share entity.
 */
export async function createShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const { targetUserEmail, permissions, expiresInHours, message } = req.body;

    const share = await shareService.createShare({
      ownerId: userId,
      fileId,
      targetEmail: targetUserEmail,
      permissions,
      expiresInHours,
      message,
    });

    res.status(201).json(share);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:id/shares
 *
 * Lists all shares for a specific file.
 * Requires the requesting user to be the file owner.
 * Returns 200 with an array of share entities.
 */
export async function listShares(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;

    const shares = await shareService.listSharesForFile({ fileId, ownerId: userId });

    res.status(200).json(shares);
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/files/:id/shares/:userId
 *
 * Updates the permissions on an existing share.
 * Request body validated by updateShareSchema middleware.
 * Returns 200 on success.
 */
export async function updateShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.user!.userId;
    const fileId = req.params.id;
    const targetUserId = req.params.userId;
    const { permissions } = req.body;

    await shareService.updatePermissions({
      ownerId,
      fileId,
      targetUserId,
      permissions,
    });

    res.status(200).json({ message: 'Share permissions updated' });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/files/:id/shares/:userId
 *
 * Revokes a share for a specific user on a file.
 * Returns 204 No Content on success.
 */
export async function revokeShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.user!.userId;
    const fileId = req.params.id;
    const targetUserId = req.params.userId;

    await shareService.revokeShare({
      ownerId,
      fileId,
      targetUserId,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/shared
 *
 * Lists files shared with the current user (shared-with-me view).
 * Query params: cursor, limit.
 * Returns 200 with paginated share results.
 */
export async function sharedWithMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const result = await shareService.getSharedWithMe({
      userId,
      pagination: { cursor, limit },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
