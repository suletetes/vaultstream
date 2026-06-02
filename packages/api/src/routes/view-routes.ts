/**
 * View Routes — Express Router for view-related endpoints.
 *
 * Routes:
 * - GET /api/recent → Recently accessed files (cache-aside)
 * - GET /api/shared → Files shared with the current user (cache-aside)
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { getRecentFiles, getSharedWithMe } from '../controllers/view-controller';

const router = Router();

// GET /api/recent — Recently accessed files
router.get(
  '/api/recent',
  cognitoAuth(),
  getRecentFiles,
);

// GET /api/shared — Files shared with the current user
router.get(
  '/api/shared',
  cognitoAuth(),
  getSharedWithMe,
);

export { router as viewRoutes };
