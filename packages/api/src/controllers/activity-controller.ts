/**
 * ActivityController — Express route handlers for activity feed operations.
 *
 * Handles:
 * - getActivityFeed: Get the current user's activity feed
 *
 * Validates: Requirements 22.3, 22.4
 */

import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification-service';

/**
 * GET /api/activity
 *
 * Returns the current user's activity feed sorted by timestamp descending.
 * Query params: cursor, limit.
 * Returns 200 with paginated activity results.
 */
export async function getActivityFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const result = await notificationService.getActivityFeed({
      userId,
      pagination: { cursor, limit },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
