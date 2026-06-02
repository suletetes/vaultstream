/**
 * Share Routes — Express Router for file sharing endpoints.
 *
 * Routes:
 * - POST   /api/files/:id/share         → Share a file with another user
 * - GET    /api/files/:id/shares         → List all shares for a file
 * - PUT    /api/files/:id/shares/:userId → Update share permissions
 * - DELETE /api/files/:id/shares/:userId → Revoke a share
 * - GET    /api/shared                   → List files shared with current user
 *
 * Validates: Requirements 4.1, 4.6, 4.7, 4.10
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createShareSchema, updateShareSchema } from '@vaultstream/shared';
import { createShare, listShares, updateShare, revokeShare, sharedWithMe } from '../controllers/share-controller';

const router = Router();

// POST /api/files/:id/share — Share a file with another user
router.post(
  '/api/files/:id/share',
  cognitoAuth(),
  validate({ body: createShareSchema }),
  createShare,
);

// GET /api/files/:id/shares — List all shares for a file
router.get(
  '/api/files/:id/shares',
  cognitoAuth(),
  listShares,
);

// PUT /api/files/:id/shares/:userId — Update share permissions
router.put(
  '/api/files/:id/shares/:userId',
  cognitoAuth(),
  validate({ body: updateShareSchema }),
  updateShare,
);

// DELETE /api/files/:id/shares/:userId — Revoke a share
router.delete(
  '/api/files/:id/shares/:userId',
  cognitoAuth(),
  revokeShare,
);

// GET /api/shared — List files shared with current user
router.get(
  '/api/shared',
  cognitoAuth(),
  sharedWithMe,
);

export { router as shareRoutes };
