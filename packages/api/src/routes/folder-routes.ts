/**
 * Folder Routes — Express Router for folder management endpoints.
 *
 * Routes:
 * - POST   /api/folders        → Create a new folder
 * - GET    /api/folders/:id    → List folder contents
 * - PUT    /api/folders/:id    → Rename a folder
 * - DELETE /api/folders/:id    → Delete a folder
 * - POST   /api/files/:id/move → Move a file to a different folder
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createFolderSchema, renameFolderSchema, moveFileSchema } from '@vaultstream/shared';
import { createFolder, listContents, renameFolder, deleteFolder, moveFile } from '../controllers/folder-controller';

const router = Router();

// POST /api/folders — Create a new folder
router.post(
  '/api/folders',
  cognitoAuth(),
  validate({ body: createFolderSchema }),
  createFolder,
);

// GET /api/folders/:id — List folder contents
router.get(
  '/api/folders/:id',
  cognitoAuth(),
  listContents,
);

// PUT /api/folders/:id — Rename a folder
router.put(
  '/api/folders/:id',
  cognitoAuth(),
  validate({ body: renameFolderSchema }),
  renameFolder,
);

// DELETE /api/folders/:id — Delete a folder
router.delete(
  '/api/folders/:id',
  cognitoAuth(),
  deleteFolder,
);

// POST /api/files/:id/move — Move a file to a different folder
router.post(
  '/api/files/:id/move',
  cognitoAuth(),
  validate({ body: moveFileSchema }),
  moveFile,
);

export { router as folderRoutes };
