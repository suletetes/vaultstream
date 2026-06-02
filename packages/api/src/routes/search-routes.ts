/**
 * Search Routes — Express Router for search endpoint.
 *
 * Routes:
 * - GET /api/search → Search files by name, tags, MIME type
 *
 * Requirements: 18.1
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { search } from '../controllers/search-controller';

const router = Router();

// GET /api/search — Search files
router.get('/api/search', cognitoAuth(), search);

export { router as searchRoutes };
