/**
 * VaultStream Entity Types
 *
 * DynamoDB single-table design entity interfaces.
 */

// ─── File Entity ────────────────────────────────────────────────────────────

export interface FileEntity {
  PK: `USER#${string}`;
  SK: `FILE#${string}`;
  entityType: 'FILE';
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  s3VersionId: string;
  encryptedDataKey: string;
  kmsKeyId: string;
  thumbnailKey: string | null;
  folderId: string;
  tags: string[];
  storageClass: StorageClass;
  virusScanStatus: VirusScanStatus;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  GSI1PK: `USER#${string}`;
  GSI1SK: string;
  GSI2PK: `FOLDER#${string}`;
  GSI2SK: string;
}

// ─── Folder Entity ──────────────────────────────────────────────────────────

export interface FolderEntity {
  PK: `USER#${string}`;
  SK: `FOLDER#${string}`;
  entityType: 'FOLDER';
  folderId: string;
  folderName: string;
  parentFolderId: string;
  fileCount: number;
  totalSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  GSI2PK: `FOLDER#${string}`;
  GSI2SK: string;
}

// ─── Share Entity ───────────────────────────────────────────────────────────

export interface ShareEntity {
  PK: `FILE#${string}`;
  SK: `SHARE#${string}`;
  entityType: 'SHARE';
  fileId: string;
  sharedBy: string;
  sharedWith: string;
  permissions: Permission;
  sharedAt: string;
  expiresAt?: number;
  GSI3PK: `USER#${string}`;
  GSI3SK: string;
}

// ─── User Profile Entity ────────────────────────────────────────────────────

export interface UserProfileEntity {
  PK: `USER#${string}`;
  SK: `PROFILE#${string}`;
  entityType: 'USER_PROFILE';
  email: string;
  displayName: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  tier: Tier;
  role: Role;
  createdAt: string;
  updatedAt: string;
  GSI1PK: 'USERS';
  GSI1SK: string;
}

// ─── File Version Entity ────────────────────────────────────────────────────

export interface FileVersionEntity {
  PK: `FILE#${string}`;
  SK: `VERSION#${string}`;
  entityType: 'FILE_VERSION';
  fileId: string;
  versionNumber: number;
  s3VersionId: string;
  encryptedDataKey: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

// ─── Comment Entity ─────────────────────────────────────────────────────────

export interface CommentEntity {
  PK: `FILE#${string}`;
  SK: `COMMENT#${string}`;
  entityType: 'COMMENT';
  commentId: string;
  fileId: string;
  userId: string;
  content: string;
  parentCommentId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Enums and Shared Types ─────────────────────────────────────────────────

export type StorageClass = 'STANDARD' | 'STANDARD_IA' | 'GLACIER_IR' | 'DEEP_ARCHIVE';

export type VirusScanStatus = 'pending' | 'clean' | 'infected' | 'error' | 'skipped';

export type Permission = 'view' | 'download' | 'edit';

export type Tier = 'free' | 'pro' | 'enterprise';

export type Role = 'user' | 'admin';

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}
