/**
 * Activity Routes — Express Router for activity feed endpoints.
 *
 * Routes:
 * - GET /api/activity → Get the current user's activity feed
 *
 * Validates: Requirements 22.3, 22.4
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { getActivityFeed } from '../controllers/activity-controller';

const router = Router();

// GET /api/activity — Get the current user's activity feed
router.get(
  '/api/activity',
  cognitoAuth(),
  getActivityFeed,
);

export { router as activityRoutes };
