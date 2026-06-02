/**
 * Admin Routes — Express Router for admin and stats endpoints.
 *
 * Routes:
 * - GET /api/stats → User storage statistics (all users)
 * - GET /api/admin/users → List all users (admin only)
 * - GET /api/admin/health → System health metrics (admin only)
 * - GET /api/admin/analytics → Storage analytics (admin only)
 * - POST /api/admin/users/:id/disable → Disable user (admin only)
 * - GET /api/admin/dlq → DLQ status (admin only)
 *
 * Requirements: 20.6, 23.1, 23.2, 23.6
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import {
  listUsers,
  systemHealth,
  storageAnalytics,
  disableUser,
  dlqStatus,
  getUserStats,
} from '../controllers/admin-controller';

const router = Router();

// User stats (available to all authenticated users)
router.get('/api/stats', cognitoAuth(), getUserStats);

// Admin endpoints (admin role verified inside handlers)
router.get('/api/admin/users', cognitoAuth(), listUsers);
router.get('/api/admin/health', cognitoAuth(), systemHealth);
router.get('/api/admin/analytics', cognitoAuth(), storageAnalytics);
router.post('/api/admin/users/:id/disable', cognitoAuth(), disableUser);
router.get('/api/admin/dlq', cognitoAuth(), dlqStatus);

export { router as adminRoutes };
