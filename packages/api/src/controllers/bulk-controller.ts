/**
 * BulkController — Express route handlers for bulk operations.
 *
 * Handles:
 * - bulkDownload: Generate download URLs for multiple files
 * - bulkDelete: Soft-delete multiple files
 * - bulkMove: Move multiple files to a target folder
 *
 * Requirements: 19.1, 19.2, 19.3
 */

import { Request, Response, NextFunction } from 'express';
import { bulkService } from '../services/bulk-service';

/**
 * POST /api/bulk/download
 * Body: { fileIds: string[] }
 */
export async function bulkDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { fileIds } = req.body;

    const result = await bulkService.bulkDownload(userId, fileIds);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bulk/delete
 * Body: { fileIds: string[] }
 */
export async function bulkDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { fileIds } = req.body;

    const result = await bulkService.bulkDelete(userId, fileIds);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bulk/move
 * Body: { fileIds: string[], targetFolderId: string }
 */
export async function bulkMove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { fileIds, targetFolderId } = req.body;

    const result = await bulkService.bulkMove(userId, fileIds, targetFolderId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
