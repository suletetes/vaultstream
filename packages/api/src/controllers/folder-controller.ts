/**
 * FolderController — Express route handlers for folder operations.
 *
 * Handles:
 * - createFolder: Create a new folder
 * - listContents: List folder contents with pagination
 * - renameFolder: Rename an existing folder
 * - deleteFolder: Delete an empty folder
 * - moveFile: Move a file to a different folder
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { Request, Response, NextFunction } from 'express';
import { folderService } from '../services/folder-service';

/**
 * POST /api/folders
 *
 * Creates a new folder. Request body validated by createFolderSchema middleware.
 * Returns 201 with the created folder entity.
 */
export async function createFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { folderName, parentFolderId } = req.body;
    const userId = req.user!.userId;

    const folder = await folderService.createFolder({
      userId,
      folderName,
      parentFolderId,
    });

    res.status(201).json(folder);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/folders/:id
 *
 * Lists the contents of a folder with pagination support.
 * Query params: cursor, limit.
 * Returns 200 with paginated folder contents.
 */
export async function listContents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const folderId = req.params.id;
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const result = await folderService.listContents({
      userId,
      folderId,
      pagination: { cursor, limit },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/folders/:id
 *
 * Renames a folder. Request body validated by renameFolderSchema middleware.
 * Returns 200 with the updated folder entity.
 */
export async function renameFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const folderId = req.params.id;
    const { folderName } = req.body;

    const folder = await folderService.renameFolder({
      userId,
      folderId,
      newName: folderName,
    });

    res.status(200).json(folder);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/folders/:id
 *
 * Deletes an empty folder.
 * Returns 204 No Content on success.
 */
export async function deleteFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const folderId = req.params.id;

    await folderService.deleteFolder({
      userId,
      folderId,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/files/:id/move
 *
 * Moves a file to a different folder. Request body validated by moveFileSchema middleware.
 * Returns 200 on success.
 */
export async function moveFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const { targetFolderId } = req.body;

    await folderService.moveFile({
      userId,
      fileId,
      targetFolderId,
    });

    res.status(200).json({ message: 'File moved successfully' });
  } catch (error) {
    next(error);
  }
}
