/**
 * VaultStream Zod Validation Schemas
 *
 * Request/response validation schemas for all API endpoints.
 */

import { z } from 'zod';
import {
  ALLOWED_MIME_TYPES,
  FILENAME_REGEX,
  FOLDER_NAME_REGEX,
  MAX_FILE_SIZE_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_TAGS_PER_FILE,
  MAX_TAG_LENGTH,
  MAX_SHARE_EXPIRY_HOURS,
  MAX_COMMENT_LENGTH,
  MAX_BULK_FILES,
  PAGINATION,
} from '../constants';

// ─── File Schemas ───────────────────────────────────────────────────────────

export const uploadUrlSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(MAX_FILENAME_LENGTH)
    .regex(FILENAME_REGEX, 'Filename contains invalid characters'),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  folderId: z.string().optional(),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_FILE).optional(),
});

export type UploadUrlRequest = z.infer<typeof uploadUrlSchema>;

export const uploadCompleteSchema = z.object({
  fileId: z.string().min(1),
  etag: z.string().min(1),
  s3VersionId: z.string().min(1),
});

export type UploadCompleteRequest = z.infer<typeof uploadCompleteSchema>;

export const updateFileSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(MAX_FILENAME_LENGTH)
    .regex(FILENAME_REGEX, 'Filename contains invalid characters')
    .optional(),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_FILE).optional(),
});

export type UpdateFileRequest = z.infer<typeof updateFileSchema>;

export const moveFileSchema = z.object({
  targetFolderId: z.string().min(1),
});

export type MoveFileRequest = z.infer<typeof moveFileSchema>;

// ─── Folder Schemas ─────────────────────────────────────────────────────────

export const createFolderSchema = z.object({
  folderName: z
    .string()
    .min(1)
    .max(MAX_FOLDER_NAME_LENGTH)
    .regex(FOLDER_NAME_REGEX, 'Folder name contains invalid characters'),
  parentFolderId: z.string().optional().default('ROOT'),
});

export type CreateFolderRequest = z.infer<typeof createFolderSchema>;

export const renameFolderSchema = z.object({
  folderName: z
    .string()
    .min(1)
    .max(MAX_FOLDER_NAME_LENGTH)
    .regex(FOLDER_NAME_REGEX, 'Folder name contains invalid characters'),
});

export type RenameFolderRequest = z.infer<typeof renameFolderSchema>;

// ─── Share Schemas ──────────────────────────────────────────────────────────

export const createShareSchema = z.object({
  targetUserEmail: z.string().email(),
  permissions: z.enum(['view', 'download', 'edit']),
  expiresInHours: z.number().int().positive().max(MAX_SHARE_EXPIRY_HOURS).optional(),
  message: z.string().max(500).optional(),
});

export type CreateShareRequest = z.infer<typeof createShareSchema>;

export const updateShareSchema = z.object({
  permissions: z.enum(['view', 'download', 'edit']),
});

export type UpdateShareRequest = z.infer<typeof updateShareSchema>;

// ─── Search Schemas ─────────────────────────────────────────────────────────

export const searchSchema = z.object({
  query: z.string().min(1).max(200).optional(),
  tags: z.array(z.string()).max(MAX_TAGS_PER_FILE).optional(),
  mimeType: z.string().optional(),
  includeShared: z.boolean().optional().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(PAGINATION.maxLimit).optional().default(PAGINATION.defaultLimit),
});

export type SearchRequest = z.infer<typeof searchSchema>;

// ─── Pagination Schema ──────────────────────────────────────────────────────

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(PAGINATION.maxLimit).optional().default(PAGINATION.defaultLimit),
});

export type PaginationRequest = z.infer<typeof paginationSchema>;

// ─── Comment Schemas ────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  content: z.string().min(1).max(MAX_COMMENT_LENGTH),
  parentCommentId: z.string().optional(),
});

export type CreateCommentRequest = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(MAX_COMMENT_LENGTH),
});

export type UpdateCommentRequest = z.infer<typeof updateCommentSchema>;

// ─── Bulk Operation Schemas ─────────────────────────────────────────────────

export const bulkDownloadSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_FILES),
});

export type BulkDownloadRequest = z.infer<typeof bulkDownloadSchema>;

export const bulkDeleteSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_FILES),
});

export type BulkDeleteRequest = z.infer<typeof bulkDeleteSchema>;

export const bulkMoveSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_FILES),
  targetFolderId: z.string().min(1),
});

export type BulkMoveRequest = z.infer<typeof bulkMoveSchema>;

// ─── Webhook Schemas ────────────────────────────────────────────────────────

export const registerWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secret: z.string().min(16).max(256),
});

export type RegisterWebhookRequest = z.infer<typeof registerWebhookSchema>;

// ─── Admin Schemas ──────────────────────────────────────────────────────────

export const disableUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type DisableUserRequest = z.infer<typeof disableUserSchema>;

// ─── Audit Query Schema ─────────────────────────────────────────────────────

export const auditQuerySchema = z.object({
  userId: z.string().optional(),
  fileId: z.string().optional(),
  eventType: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(PAGINATION.maxLimit).optional().default(PAGINATION.defaultLimit),
});

export type AuditQueryRequest = z.infer<typeof auditQuerySchema>;

// ─── ID Parameter Schemas ───────────────────────────────────────────────────

export const fileIdParamSchema = z.object({
  id: z.string().min(1),
});

export const folderIdParamSchema = z.object({
  id: z.string().min(1),
});

export const shareUserIdParamSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
});

export const versionParamSchema = z.object({
  id: z.string().min(1),
  v: z.string().min(1),
});

export const commentIdParamSchema = z.object({
  id: z.string().min(1),
  cid: z.string().min(1),
});

export const webhookIdParamSchema = z.object({
  id: z.string().min(1),
});
