/**
 * @vaultstream/shared
 *
 * Shared types, schemas, constants, and utilities for the VaultStream platform.
 */

// Constants
export {
  ALLOWED_MIME_TYPES,
  FILENAME_REGEX,
  FOLDER_NAME_REGEX,
  MAX_FILE_SIZE_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_DEPTH,
  MAX_SHARES_PER_FILE,
  MAX_VERSIONS_PER_FILE,
  MAX_COMMENTS_PER_FILE,
  MAX_COMMENT_LENGTH,
  MAX_TAGS_PER_FILE,
  MAX_TAG_LENGTH,
  MAX_WEBHOOKS_PER_USER,
  MAX_BULK_FILES,
  MAX_BULK_DOWNLOAD_SIZE,
  UPLOAD_URL_EXPIRY_SECONDS,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  SHARED_DOWNLOAD_URL_EXPIRY_SECONDS,
  SOFT_DELETE_RETENTION_DAYS,
  COMMENT_EDIT_WINDOW_HOURS,
  MAX_SHARE_EXPIRY_HOURS,
  TIER_QUOTAS,
  RATE_LIMITS,
  CACHE_TTL,
  PAGINATION,
  LIFECYCLE_TRANSITIONS,
} from './constants';
export type { AllowedMimeType, TierQuota, RateLimits } from './constants';

// Types
export type {
  FileEntity,
  FolderEntity,
  ShareEntity,
  UserProfileEntity,
  FileVersionEntity,
  CommentEntity,
  StorageClass,
  VirusScanStatus,
  Permission,
  Tier,
  Role,
} from './types';

// Errors
export {
  ErrorCode,
  ERROR_STATUS_CODES,
  AppError,
  validationError,
  unauthorizedError,
  forbiddenError,
  fileNotFoundError,
  versionNotFoundError,
  quotaExceededError,
  fileInfectedError,
  rateLimitedError,
  internalError,
  serviceUnavailableError,
} from './errors';
export type { ValidationDetail, ErrorResponse } from './errors';

// Schemas
export {
  uploadUrlSchema,
  uploadCompleteSchema,
  updateFileSchema,
  moveFileSchema,
  createFolderSchema,
  renameFolderSchema,
  createShareSchema,
  updateShareSchema,
  searchSchema,
  paginationSchema,
  createCommentSchema,
  updateCommentSchema,
  bulkDownloadSchema,
  bulkDeleteSchema,
  bulkMoveSchema,
  registerWebhookSchema,
  disableUserSchema,
  auditQuerySchema,
  fileIdParamSchema,
  folderIdParamSchema,
  shareUserIdParamSchema,
  versionParamSchema,
  commentIdParamSchema,
  webhookIdParamSchema,
} from './schemas';
export type {
  UploadUrlRequest,
  UploadCompleteRequest,
  UpdateFileRequest,
  MoveFileRequest,
  CreateFolderRequest,
  RenameFolderRequest,
  CreateShareRequest,
  UpdateShareRequest,
  SearchRequest,
  PaginationRequest,
  CreateCommentRequest,
  UpdateCommentRequest,
  BulkDownloadRequest,
  BulkDeleteRequest,
  BulkMoveRequest,
  RegisterWebhookRequest,
  DisableUserRequest,
  AuditQueryRequest,
} from './schemas';

// Utilities
export { generateId, extractTimestamp, isValidUlid } from './utils/ulid';
export { sanitizeFilename, isValidFilename, containsPathTraversal } from './utils/sanitize';
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  normalizePaginationParams,
  clampLimit,
  encodeCursor,
  decodeCursor,
  buildPaginatedResult,
} from './utils/pagination';
export type { PaginationParams, PaginatedResult } from './utils/pagination';
