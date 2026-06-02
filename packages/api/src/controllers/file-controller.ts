/**
 * FileController — Express route handlers for file operations.
 *
 * Handles:
 * - generateUploadUrl: Validates request body and generates a presigned upload URL
 * - confirmUpload: Validates upload completion and confirms the file in DynamoDB
 * - generateDownloadUrl: Generates a presigned download URL for authorized users
 * - listVersions: Lists all versions of a file
 * - restoreVersion: Restores a previous version of a file
 * - softDeleteFile: Soft-deletes a file (moves to trash)
 * - restoreFile: Restores a soft-deleted file from trash
 * - getTrashBin: Lists all soft-deleted files
 * - emptyTrash: Permanently deletes all soft-deleted files
 */

import { Request, Response, NextFunction } from 'express';
import { fileService } from '../services/file-service';

/**
 * POST /api/files/upload-url
 *
 * Validates the request body (already validated by Zod middleware),
 * calls fileService.generateUploadUrl, and returns the presigned URL details.
 */
export async function generateUploadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filename, mimeType, sizeBytes, folderId, tags } = req.body;
    const userId = req.user!.userId;

    const result = await fileService.generateUploadUrl({
      userId,
      filename,
      mimeType,
      sizeBytes,
      folderId,
      tags,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/files/upload-complete
 *
 * Validates the upload completion request (already validated by Zod middleware),
 * calls fileService.confirmUpload, and returns the updated file metadata.
 */
export async function confirmUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { fileId, etag, s3VersionId } = req.body;
    const userId = req.user!.userId;

    const file = await fileService.confirmUpload({
      userId,
      fileId,
      etag,
      s3VersionId,
    });

    res.status(200).json(file);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:id/download-url
 *
 * Uses authorizeFileAccess('download') middleware to verify access.
 * The middleware attaches req.file with the file metadata.
 * Calls fileService.generateDownloadUrl and returns the download URL.
 */
export async function generateDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileMetadata = req.file!;
    const isOwner = fileMetadata.PK === `USER#${userId}`;

    const result = await fileService.generateDownloadUrl({
      userId,
      fileId: fileMetadata.fileId,
      fileMetadata,
      isOwner,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:id/versions
 *
 * Lists all versions of a file. Requires ownership (cognitoAuth).
 */
export async function listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;

    const result = await fileService.listVersions({
      userId,
      fileId,
      pagination: { limit, cursor },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/files/:id/versions/:v/restore
 *
 * Restores a previous version of a file. Requires ownership (cognitoAuth).
 */
export async function restoreVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const versionNumber = parseInt(req.params.v, 10);

    if (isNaN(versionNumber) || versionNumber < 1) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid version number' },
      });
      return;
    }

    const result = await fileService.restoreVersion({
      userId,
      fileId,
      versionNumber,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/files/:id
 *
 * Soft-deletes a file. Requires ownership via authorizeFileAccess('edit').
 */
export async function softDeleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;

    await fileService.softDelete({ userId, fileId });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/files/:id/restore
 *
 * Restores a soft-deleted file from trash. Requires ownership (cognitoAuth).
 */
export async function restoreFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;

    const result = await fileService.restore({ userId, fileId });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/trash
 *
 * Lists all soft-deleted files in the user's trash bin.
 */
export async function getTrashBin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;

    const result = await fileService.getTrashBin({
      userId,
      pagination: { limit, cursor },
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/trash
 *
 * Permanently deletes all soft-deleted files in the user's trash bin.
 */
export async function emptyTrash(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    await fileService.emptyTrash(userId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
