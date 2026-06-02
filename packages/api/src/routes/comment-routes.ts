/**
 * Comment Routes — Express Router for file comment endpoints.
 *
 * Routes:
 * - POST /api/files/:id/comments → Add comment
 * - GET /api/files/:id/comments → List comments
 * - PUT /api/files/:id/comments/:cid → Edit comment
 * - DELETE /api/files/:id/comments/:cid → Delete comment
 *
 * Requirements: 26.1, 26.2, 26.4, 26.5
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { addComment, listComments, editComment, deleteComment } from '../controllers/comment-controller';

const router = Router();

router.post('/api/files/:id/comments', cognitoAuth(), addComment);
router.get('/api/files/:id/comments', cognitoAuth(), listComments);
router.put('/api/files/:id/comments/:cid', cognitoAuth(), editComment);
router.delete('/api/files/:id/comments/:cid', cognitoAuth(), deleteComment);

export { router as commentRoutes };
