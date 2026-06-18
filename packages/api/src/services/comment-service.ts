/**
 * CommentService — File comments and threaded replies
 *
 * - addComment: Add comment to a file (requires at least "view" permission)
 * - listComments: List all comments sorted by creation time (ascending)
 * - editComment: Edit own comment within 24h
 * - deleteComment: Delete own comment within 24h, or file owner can delete any
 * - Limits: 2000 chars, 500 comments per file, one level of nesting
 *
 * Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7
 */

import { docClient, TABLE_NAME } from '../db/dynamodb';
import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AppError, ErrorCode, generateId } from '@vaultstream/shared';

const MAX_COMMENT_LENGTH = 2000;
const MAX_COMMENTS_PER_FILE = 500;
const EDIT_WINDOW_HOURS = 24;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Comment {
  commentId: string;
  fileId: string;
  authorId: string;
  authorDisplayName?: string;
  text: string;
  parentCommentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddCommentParams {
  fileId: string;
  authorId: string;
  text: string;
  parentCommentId?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class CommentService {
  /**
   * Add a comment to a file.
   */
  async addComment(params: AddCommentParams): Promise<Comment> {
    // Validate text length
    if (!params.text || params.text.length > MAX_COMMENT_LENGTH) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters`,
      });
    }

    // Check comment count limit
    const existingCount = await this.getCommentCount(params.fileId);
    if (existingCount >= MAX_COMMENTS_PER_FILE) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Maximum ${MAX_COMMENTS_PER_FILE} comments per file`,
      });
    }

    // Validate parent comment exists if threaded reply
    if (params.parentCommentId) {
      const parent = await this.getComment(params.fileId, params.parentCommentId);
      if (!parent) {
        throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Parent comment not found' });
      }
      // Only one level of nesting allowed
      if (parent.parentCommentId) {
        throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Only one level of comment nesting is allowed' });
      }
    }

    const commentId = `comment_${generateId()}`;
    const now = new Date().toISOString();

    const comment: Comment = {
      commentId,
      fileId: params.fileId,
      authorId: params.authorId,
      text: params.text,
      parentCommentId: params.parentCommentId,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `FILE#${params.fileId}`,
        SK: `COMMENT#${commentId}`,
        entityType: 'COMMENT',
        ...comment,
      },
    }));

    return comment;
  }

  /**
   * List all comments for a file, sorted by creation time ascending.
   */
  async listComments(fileId: string): Promise<Comment[]> {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `FILE#${fileId}`,
        ':skPrefix': 'COMMENT#',
      },
      ScanIndexForward: true, // Ascending by creation time (ULID-based SK)
    }));

    return (result.Items || []).map((item) => ({
      commentId: item.commentId as string,
      fileId: item.fileId as string,
      authorId: item.authorId as string,
      authorDisplayName: item.authorDisplayName as string | undefined,
      text: item.text as string,
      parentCommentId: item.parentCommentId as string | undefined,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }));
  }

  /**
   * Edit a comment (author only, within 24h).
   */
  async editComment(fileId: string, commentId: string, userId: string, newText: string): Promise<Comment> {
    if (!newText || newText.length > MAX_COMMENT_LENGTH) {
      throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters` });
    }

    const comment = await this.getComment(fileId, commentId);
    if (!comment) {
      throw new AppError({ code: ErrorCode.FILE_NOT_FOUND, message: 'Comment not found' });
    }

    if (comment.authorId !== userId) {
      throw new AppError({ code: ErrorCode.FORBIDDEN, message: 'Only the comment author can edit' });
    }

    // Check 24h edit window
    const createdAt = new Date(comment.createdAt).getTime();
    const now = Date.now();
    if (now - createdAt > EDIT_WINDOW_HOURS * 60 * 60 * 1000) {
      throw new AppError({ code: ErrorCode.FORBIDDEN, message: 'Comments can only be edited within 24 hours of creation' });
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `FILE#${fileId}`, SK: `COMMENT#${commentId}` },
      UpdateExpression: 'SET #text = :text, updatedAt = :now',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: { ':text': newText, ':now': new Date().toISOString() },
    }));

    return { ...comment, text: newText, updatedAt: new Date().toISOString() };
  }

  /**
   * Delete a comment (author within 24h, or file owner anytime).
   */
  async deleteComment(fileId: string, commentId: string, userId: string, isFileOwner: boolean): Promise<void> {
    const comment = await this.getComment(fileId, commentId);
    if (!comment) {
      throw new AppError({ code: ErrorCode.FILE_NOT_FOUND, message: 'Comment not found' });
    }

    // File owner can delete any comment
    if (!isFileOwner) {
      if (comment.authorId !== userId) {
        throw new AppError({ code: ErrorCode.FORBIDDEN, message: 'Only the comment author or file owner can delete' });
      }

      // Check 24h window for non-owners
      const createdAt = new Date(comment.createdAt).getTime();
      if (Date.now() - createdAt > EDIT_WINDOW_HOURS * 60 * 60 * 1000) {
        throw new AppError({ code: ErrorCode.FORBIDDEN, message: 'Comments can only be deleted within 24 hours of creation' });
      }
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `FILE#${fileId}`, SK: `COMMENT#${commentId}` },
    }));
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async getComment(fileId: string, commentId: string): Promise<Comment | null> {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `FILE#${fileId}`,
        ':sk': `COMMENT#${commentId}`,
      },
      Limit: 1,
    }));

    const item = result.Items?.[0];
    if (!item) return null;

    return {
      commentId: item.commentId as string,
      fileId: item.fileId as string,
      authorId: item.authorId as string,
      text: item.text as string,
      parentCommentId: item.parentCommentId as string | undefined,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }

  private async getCommentCount(fileId: string): Promise<number> {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `FILE#${fileId}`,
        ':skPrefix': 'COMMENT#',
      },
      Select: 'COUNT',
    }));

    return result.Count || 0;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const commentService = new CommentService();
