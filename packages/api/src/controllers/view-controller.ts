/**
 * ViewController — Express route handlers for view-related endpoints.
 *
 * Handles:
 * - getRecentFiles: Returns recently accessed files with cache-aside pattern
 * - getSharedWithMe: Returns files shared with the current user
 */

import { Request, Response, NextFunction } from 'express';
import { fileService } from '../services/file-service';
import { shareService } from '../services/share-service';

/**
 * GET /api/recent
 *
 * Returns the top 20 recently accessed files for the authenticated user.
 * Uses cache-aside pattern (Redis sorted set → GSI1 fallback).
 */
export async function getRecentFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    const files = await fileService.getRecentFiles(userId);

    res.status(200).json({ items: files });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/shared
 *
 * Returns files shared with the authenticated user.
 * Uses cache-aside pattern (Redis sorted set → GSI3 fallback).
 */
export async function getSharedWithMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;

    const result = await shareService.getSharedWithMe({
      userId,
      pagination: { limit, cursor },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
