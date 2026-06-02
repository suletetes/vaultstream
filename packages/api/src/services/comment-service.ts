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

import { getDynamoDBDocClient } from '../db/dynamodb';
import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AppError } from '@vaultstream/shared';
import { generateUlid } from '@vaultstream/shared';
import pino from 'pino';

const logger = pino({ name: 'comment-service' });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'vaultstream-metadata';
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
      throw new AppError(
        'VALIDATION_ERROR',
        `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters`,
        400
      );
    }

    // Check comment count limit
    const existingCount = await this.getCommentCount(params.fileId);
    if (existingCount >= MAX_COMMENTS_PER_FILE) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Maximum ${MAX_COMMENTS_PER_FILE} comments per file`,
        400
      );
    }

    // Validate parent comment exists if threaded reply
    if (params.parentCommentId) {
      const parent = await this.getComment(params.fileId, params.parentCommentId);
      if (!parent) {
        throw new AppError('VALIDATION_ERROR', 'Parent comment not found', 400);
      }
      // Only one level of nesting allowed
      if (parent.parentCommentId) {
        throw new AppError('VALIDATION_ERROR', 'Only one level of comment nesting is allowed', 400);
      }
    }

    const commentId = `comment_${generateUlid()}`;
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

    const client = getDynamoDBDocClient();
    await client.send(new PutCommand({
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
    const client = getDynamoDBDocClient();
    const result = await client.send(new QueryCommand({
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
      throw new AppError('VALIDATION_ERROR', `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters`, 400);
    }

    const comment = await this.getComment(fileId, commentId);
    if (!comment) {
      throw new AppError('FILE_NOT_FOUND', 'Comment not found', 404);
    }

    if (comment.authorId !== userId) {
      throw new AppError('FORBIDDEN', 'Only the comment author can edit', 403);
    }

    // Check 24h edit window
    const createdAt = new Date(comment.createdAt).getTime();
    const now = Date.now();
    if (now - createdAt > EDIT_WINDOW_HOURS * 60 * 60 * 1000) {
      throw new AppError('FORBIDDEN', 'Comments can only be edited within 24 hours of creation', 403);
    }

    const client = getDynamoDBDocClient();
    await client.send(new UpdateCommand({
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
      throw new AppError('FILE_NOT_FOUND', 'Comment not found', 404);
    }

    // File owner can delete any comment
    if (!isFileOwner) {
      if (comment.authorId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the comment author or file owner can delete', 403);
      }

      // Check 24h window for non-owners
      const createdAt = new Date(comment.createdAt).getTime();
      if (Date.now() - createdAt > EDIT_WINDOW_HOURS * 60 * 60 * 1000) {
        throw new AppError('FORBIDDEN', 'Comments can only be deleted within 24 hours of creation', 403);
      }
    }

    const client = getDynamoDBDocClient();
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `FILE#${fileId}`, SK: `COMMENT#${commentId}` },
    }));
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async getComment(fileId: string, commentId: string): Promise<Comment | null> {
    const client = getDynamoDBDocClient();
    const result = await client.send(new QueryCommand({
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
    const client = getDynamoDBDocClient();
    const result = await client.send(new QueryCommand({
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
