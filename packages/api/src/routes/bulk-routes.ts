/**
 * Bulk Routes — Express Router for bulk operation endpoints.
 *
 * Routes:
 * - POST /api/bulk/download → Generate download URLs for multiple files
 * - POST /api/bulk/delete → Soft-delete multiple files
 * - POST /api/bulk/move → Move multiple files to target folder
 *
 * Requirements: 19.1, 19.2, 19.3
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { bulkDownload, bulkDelete, bulkMove } from '../controllers/bulk-controller';

const router = Router();

router.post('/api/bulk/download', cognitoAuth(), bulkDownload);
router.post('/api/bulk/delete', cognitoAuth(), bulkDelete);
router.post('/api/bulk/move', cognitoAuth(), bulkMove);

export { router as bulkRoutes };
