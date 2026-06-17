/**
 * CommentController — Express route handlers for file comments.
 *
 * Handles:
 * - addComment: Add a comment to a file
 * - listComments: List all comments for a file
 * - editComment: Edit own comment (within 24h)
 * - deleteComment: Delete comment (author within 24h, or file owner)
 *
 * Requirements: 26.1, 26.2, 26.4, 26.5
 */

import { Request, Response, NextFunction } from 'express';
import { commentService } from '../services/comment-service';

/**
 * POST /api/files/:id/comments
 * Body: { text, parentCommentId? }
 */
export async function addComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const { text, parentCommentId } = req.body;

    const comment = await commentService.addComment({
      fileId,
      authorId: userId,
      text,
      parentCommentId,
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:id/comments
 */
export async function listComments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fileId = req.params.id;
    const comments = await commentService.listComments(fileId);
    res.status(200).json({ items: comments });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/files/:id/comments/:cid
 * Body: { text }
 */
export async function editComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const commentId = req.params.cid;
    const { text } = req.body;

    const comment = await commentService.editComment(fileId, commentId, userId, text);
    res.status(200).json(comment);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/files/:id/comments/:cid
 */
export async function deleteComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const fileId = req.params.id;
    const commentId = req.params.cid;

    // If authorizeFileAccess middleware ran, fileMetadata is set
    // Otherwise (e.g., route without authorize), assume not file owner
    const isFileOwner = req.fileMetadata?.PK === `USER#${userId}`;

    await commentService.deleteComment(fileId, commentId, userId, isFileOwner);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
