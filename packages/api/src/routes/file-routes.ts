/**
 * File Routes — Express Router for file management endpoints.
 *
 * Routes:
 * - POST   /api/files/upload-url           → Generate presigned upload URL
 * - POST   /api/files/upload-complete       → Confirm upload completion
 * - GET    /api/files/:id/download-url      → Generate presigned download URL
 * - GET    /api/files/:id/versions          → List file versions
 * - POST   /api/files/:id/versions/:v/restore → Restore a file version
 * - DELETE /api/files/:id                   → Soft-delete a file
 * - POST   /api/files/:id/restore           → Restore a soft-deleted file
 * - GET    /api/trash                       → List trash bin
 * - DELETE /api/trash                       → Empty trash bin
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { authorizeFileAccess } from '../middleware/authorize';
import { uploadUrlSchema, uploadCompleteSchema } from '@vaultstream/shared';
import {
  generateUploadUrl,
  confirmUpload,
  generateDownloadUrl,
  listVersions,
  restoreVersion,
  softDeleteFile,
  restoreFile,
  getTrashBin,
  emptyTrash,
} from '../controllers/file-controller';

const router = Router();

// POST /api/files/upload-url — Generate presigned upload URL
router.post(
  '/api/files/upload-url',
  cognitoAuth(),
  validate({ body: uploadUrlSchema }),
  generateUploadUrl,
);

// POST /api/files/upload-complete — Confirm upload completion
router.post(
  '/api/files/upload-complete',
  cognitoAuth(),
  validate({ body: uploadCompleteSchema }),
  confirmUpload,
);

// GET /api/files/:id/download-url — Generate presigned download URL
router.get(
  '/api/files/:id/download-url',
  cognitoAuth(),
  authorizeFileAccess('download'),
  generateDownloadUrl,
);

// GET /api/files/:id/versions — List file versions
router.get(
  '/api/files/:id/versions',
  cognitoAuth(),
  listVersions,
);

// POST /api/files/:id/versions/:v/restore — Restore a file version
router.post(
  '/api/files/:id/versions/:v/restore',
  cognitoAuth(),
  restoreVersion,
);

// DELETE /api/files/:id — Soft-delete a file
router.delete(
  '/api/files/:id',
  cognitoAuth(),
  authorizeFileAccess('edit'),
  softDeleteFile,
);

// POST /api/files/:id/restore — Restore a soft-deleted file
router.post(
  '/api/files/:id/restore',
  cognitoAuth(),
  restoreFile,
);

// GET /api/trash — List trash bin
router.get(
  '/api/trash',
  cognitoAuth(),
  getTrashBin,
);

// DELETE /api/trash — Empty trash bin
router.delete(
  '/api/trash',
  cognitoAuth(),
  emptyTrash,
);

export { router as fileRoutes };
