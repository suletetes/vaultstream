/**
 * VaultStream Constants
 *
 * Shared constants for validation, tier quotas, and rate limits.
 */

// ─── Allowed MIME Types ─────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ─── Validation Patterns ────────────────────────────────────────────────────

/** Filename: alphanumeric, dots, hyphens, underscores, spaces, parentheses */
export const FILENAME_REGEX = /^[a-zA-Z0-9._\-\s()]+$/;

/** Folder name: anything except / \ : * ? " < > | */
export const FOLDER_NAME_REGEX = /^[^/\\:*?"<>|]+$/;

// ─── Size Limits ────────────────────────────────────────────────────────────

/** Maximum file size in bytes (100MB) */
export const MAX_FILE_SIZE_BYTES = 104_857_600;

/** Maximum filename length */
export const MAX_FILENAME_LENGTH = 255;

/** Maximum folder name length */
export const MAX_FOLDER_NAME_LENGTH = 255;

/** Maximum folder nesting depth (ROOT = level 0, top-level folder = level 1) */
export const MAX_FOLDER_DEPTH = 10;

/** Maximum shares per file */
export const MAX_SHARES_PER_FILE = 50;

/** Maximum versions per file */
export const MAX_VERSIONS_PER_FILE = 50;

/** Maximum comments per file */
export const MAX_COMMENTS_PER_FILE = 500;

/** Maximum comment length in characters */
export const MAX_COMMENT_LENGTH = 2000;

/** Maximum tags per file */
export const MAX_TAGS_PER_FILE = 10;

/** Maximum tag length in characters */
export const MAX_TAG_LENGTH = 50;

/** Maximum webhooks per enterprise user */
export const MAX_WEBHOOKS_PER_USER = 5;

/** Maximum files per bulk operation */
export const MAX_BULK_FILES = 100;

/** Maximum bulk download size in bytes (500MB) */
export const MAX_BULK_DOWNLOAD_SIZE = 524_288_000;

/** Presigned upload URL expiry in seconds (5 minutes) */
export const UPLOAD_URL_EXPIRY_SECONDS = 300;

/** Presigned download URL expiry for owners in seconds (15 minutes) */
export const DOWNLOAD_URL_EXPIRY_SECONDS = 900;

/** CloudFront signed URL expiry for shared users in seconds (1 hour) */
export const SHARED_DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

/** Soft-delete retention period in days */
export const SOFT_DELETE_RETENTION_DAYS = 30;

/** Comment edit/delete window in hours */
export const COMMENT_EDIT_WINDOW_HOURS = 24;

/** Share expiration maximum in hours (1 year) */
export const MAX_SHARE_EXPIRY_HOURS = 8760;

// ─── Tier Quotas ────────────────────────────────────────────────────────────

export const TIER_QUOTAS = {
  free: 5_368_709_120,         // 5 GB
  pro: 107_374_182_400,        // 100 GB
  enterprise: 1_099_511_627_776, // 1 TB
} as const;

export type TierQuota = typeof TIER_QUOTAS;

// ─── Rate Limits (requests per minute) ──────────────────────────────────────

export const RATE_LIMITS = {
  free: {
    general: 100,
    presigned: 20,
  },
  pro: {
    general: 500,
    presigned: 100,
  },
  enterprise: {
    general: 2000,
    presigned: 500,
  },
} as const;

export type RateLimits = typeof RATE_LIMITS;

// ─── Cache TTLs (seconds) ───────────────────────────────────────────────────

export const CACHE_TTL = {
  recentFiles: 300,       // 5 minutes
  sharedWithMe: 300,      // 5 minutes
  folderContents: 600,    // 10 minutes
  fileMetadata: 600,      // 10 minutes
  fileShares: 600,        // 10 minutes
  rateLimit: 60,          // 1 minute
  uploadState: 3600,      // 1 hour
} as const;

// ─── Pagination Defaults ────────────────────────────────────────────────────

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
  recentFilesLimit: 20,
  activityFeedLimit: 100,
  activityRetentionDays: 30,
} as const;

// ─── S3 Lifecycle Transitions (days) ────────────────────────────────────────

export const LIFECYCLE_TRANSITIONS = {
  standardToStandardIA: 30,
  standardIAToGlacierIR: 90,
  glacierIRToDeepArchive: 365,
  noncurrentToStandardIA: 7,
  noncurrentToGlacierIR: 30,
  noncurrentDelete: 90,
  incompleteMultipartCleanup: 7,
} as const;
