/**
 * FileService Unit Tests — Versioning and Soft-Delete/Restore
 *
 * Tests the versioning flow including:
 * - listVersions: ownership verification, pagination, descending sort
 * - restoreVersion: ownership, version lookup, S3 copy, version cap
 * - enforceVersionCap: oldest version deletion when at limit
 *
 * Tests the soft-delete/restore flow including:
 * - softDelete: DynamoDB update, S3 delete marker, quota decrement, cache invalidation
 * - restore: quota check, folder validation, DynamoDB update, quota increment
 * - getTrashBin: filter deleted files, calculate daysRemaining, pagination
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { FileService, type RedisLike } from './file-service';
import { EncryptionService } from './encryption-service';
import { AppError, ErrorCode } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('./quota-service', () => ({
  enforceQuota: vi.fn(),
  incrementUsage: vi.fn(),
  decrementUsage: vi.fn(),
  checkQuota: vi.fn(),
}));

vi.mock('../db/dynamodb', () => ({
  docClient: { send: vi.fn().mockResolvedValue({}) },
  TABLE_NAME: 'vaultstream-metadata',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

import { enforceQuota, incrementUsage, decrementUsage, checkQuota } from './quota-service';
import { docClient } from '../db/dynamodb';

const mockEnforceQuota = vi.mocked(enforceQuota);
const mockIncrementUsage = vi.mocked(incrementUsage);
const mockDecrementUsage = vi.mocked(decrementUsage);
const mockCheckQuota = vi.mocked(checkQuota);
const mockDocClientSend = vi.mocked(docClient.send);

// Mock EncryptionService
const mockEncryptionService = {
  generateDataKey: vi.fn().mockResolvedValue({
    plaintextDek: Buffer.alloc(32, 0xab),
    encryptedDek: 'base64-encrypted-dek',
  }),
} as unknown as EncryptionService;

// Mock S3 client
const mockS3Send = vi.fn();
const mockS3Client = { send: mockS3Send } as unknown as S3Client;

// Mock EventBridge client
const mockEventBridgeSend = vi.fn().mockResolvedValue({});
const mockEventBridgeClient = { send: mockEventBridgeSend } as unknown as EventBridgeClient;

// Mock CacheService
const mockInvalidateUserCache = vi.fn().mockResolvedValue(undefined);
const mockInvalidateFileCache = vi.fn().mockResolvedValue(undefined);
const mockCacheService = {
  invalidateUserCache: mockInvalidateUserCache,
  invalidateFileCache: mockInvalidateFileCache,
  invalidateFolderCache: vi.fn(),
  getRecentFiles: vi.fn(),
  setRecentFiles: vi.fn(),
  getSharedWithMe: vi.fn(),
  setSharedWithMe: vi.fn(),
  getFileMetadata: vi.fn(),
  setFileMetadata: vi.fn(),
  getFolderContents: vi.fn(),
  setFolderContents: vi.fn(),
  isAvailable: vi.fn().mockReturnValue(true),
} as unknown as CacheService;

// Mock Redis client
const mockRedisClient: RedisLike = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
};

// ─── Test Data ──────────────────────────────────────────────────────────────

const baseFileItem = {
  PK: 'USER#user-123',
  SK: 'FILE#file-abc',
  entityType: 'FILE',
  fileId: 'file-abc',
  filename: 'document.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024 * 1024,
  s3Key: 'users/user-123/files/file-abc/3/document.pdf',
  s3VersionId: 'v3',
  encryptedDataKey: 'base64-encrypted-dek',
  kmsKeyId: 'arn:aws:kms:us-east-1:123:key/test',
  thumbnailKey: null,
  folderId: 'folder-abc',
  tags: [],
  storageClass: 'STANDARD',
  virusScanStatus: 'clean',
  version: 3,
  isDeleted: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-15T00:00:00.000Z',
  lastAccessedAt: '2024-01-15T00:00:00.000Z',
  GSI1PK: 'USER#user-123',
  GSI1SK: '2024-01-15T00:00:00.000Z',
  GSI2PK: 'FOLDER#folder-abc',
  GSI2SK: 'document.pdf',
};

const versionEntities = [
  {
    PK: 'FILE#file-abc',
    SK: 'VERSION#00003',
    entityType: 'FILE_VERSION',
    fileId: 'file-abc',
    versionNumber: 3,
    s3VersionId: 'v3',
    encryptedDataKey: 'dek-v3',
    sizeBytes: 1024 * 1024,
    uploadedBy: 'user-123',
    createdAt: '2024-01-15T00:00:00.000Z',
  },
  {
    PK: 'FILE#file-abc',
    SK: 'VERSION#00002',
    entityType: 'FILE_VERSION',
    fileId: 'file-abc',
    versionNumber: 2,
    s3VersionId: 'v2',
    encryptedDataKey: 'dek-v2',
    sizeBytes: 512 * 1024,
    uploadedBy: 'user-123',
    createdAt: '2024-01-10T00:00:00.000Z',
  },
];

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('FileService — Versioning and Soft-Delete', () => {
  let service: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({} as never);
    mockS3Send.mockResolvedValue({});
    mockCheckQuota.mockResolvedValue({ allowed: true, currentUsage: 0, limit: 5_368_709_120 });
    mockIncrementUsage.mockResolvedValue(undefined);
    mockDecrementUsage.mockResolvedValue(undefined);

    service = new FileService({
      encryptionService: mockEncryptionService,
      s3Client: mockS3Client,
      eventBridgeClient: mockEventBridgeClient,
      redisClient: mockRedisClient,
      cacheService: mockCacheService,
    });
  });

  // ─── listVersions ──────────────────────────────────────────────────────

  describe('listVersions', () => {
    it('should verify file ownership before listing versions', async () => {
      // First call: ownership check (GetCommand)
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      // Second call: QueryCommand for versions
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      const firstCall = mockDocClientSend.mock.calls[0][0];
      const input = (firstCall as { input: { Key: Record<string, string> } }).input;
      expect(input.Key.PK).toBe('USER#user-123');
      expect(input.Key.SK).toBe('FILE#file-abc');
    });

    it('should throw FORBIDDEN when user does not own the file', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(
        service.listVersions({ userId: 'user-456', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should query versions with PK=FILE#{fileId} and SK begins_with VERSION#', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      const queryCall = mockDocClientSend.mock.calls[1][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
      const values = input.ExpressionAttributeValues as Record<string, string>;
      expect(values[':pk']).toBe('FILE#file-abc');
      expect(values[':skPrefix']).toBe('VERSION#');
    });

    it('should sort versions descending (newest first)', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      const queryCall = mockDocClientSend.mock.calls[1][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.ScanIndexForward).toBe(false);
    });

    it('should use default pagination limit of 20', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      const queryCall = mockDocClientSend.mock.calls[1][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.Limit).toBe(20);
    });

    it('should respect custom pagination limit', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      await service.listVersions({
        userId: 'user-123',
        fileId: 'file-abc',
        pagination: { limit: 5 },
      });

      const queryCall = mockDocClientSend.mock.calls[1][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.Limit).toBe(5);
    });

    it('should return paginated result with items and hasMore', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({
        Items: versionEntities,
        LastEvaluatedKey: { PK: 'FILE#file-abc', SK: 'VERSION#00001' },
      } as never);

      const result = await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should return hasMore=false when no LastEvaluatedKey', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Items: versionEntities } as never);

      const result = await service.listVersions({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  // ─── restoreVersion ────────────────────────────────────────────────────

  describe('restoreVersion', () => {
    beforeEach(() => {
      mockDocClientSend.mockReset();
      mockS3Send.mockReset();
    });

    function setupRestoreVersionMocks() {
      // 1. verifyOwnership (GetCommand for file)
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      // 2. Get VERSION entity
      mockDocClientSend.mockResolvedValueOnce({ Item: versionEntities[1] } as never);
      // 3. enforceVersionCap - count query
      mockDocClientSend.mockResolvedValueOnce({ Count: 3 } as never);
      // 4. PutCommand for new VERSION entity
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // 5. UpdateCommand for FILE entity
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // S3 CopyObject
      mockS3Send.mockResolvedValue({ CopyObjectResult: {}, VersionId: 'new-v4' });
    }

    it('should verify file ownership', async () => {
      setupRestoreVersionMocks();

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      const firstCall = mockDocClientSend.mock.calls[0][0];
      const input = (firstCall as { input: { Key: Record<string, string> } }).input;
      expect(input.Key.PK).toBe('USER#user-123');
      expect(input.Key.SK).toBe('FILE#file-abc');
    });

    it('should throw FORBIDDEN when user does not own the file', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(
        service.restoreVersion({ userId: 'user-456', fileId: 'file-abc', versionNumber: 2 }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should throw VERSION_NOT_FOUND when version does not exist', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(
        service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 99 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VERSION_NOT_FOUND,
      });
    });

    it('should copy S3 object from the specified version', async () => {
      setupRestoreVersionMocks();

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      // S3 CopyObject should be called
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const copyCommand = mockS3Send.mock.calls[0][0];
      const input = (copyCommand as { input: Record<string, string> }).input;
      expect(input.CopySource).toContain('versionId=v2');
    });

    it('should increment version counter in the returned file', async () => {
      setupRestoreVersionMocks();

      const result = await service.restoreVersion({
        userId: 'user-123',
        fileId: 'file-abc',
        versionNumber: 2,
      });

      expect(result.version).toBe(4); // was 3, now 4
    });

    it('should create a new FILE_VERSION entity in DynamoDB', async () => {
      setupRestoreVersionMocks();

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      // The PutCommand for the new version entity (4th DynamoDB call)
      const putCall = mockDocClientSend.mock.calls[3][0];
      const input = (putCall as { input: { Item: Record<string, unknown> } }).input;
      expect(input.Item.PK).toBe('FILE#file-abc');
      expect(input.Item.SK).toBe('VERSION#00004');
      expect(input.Item.entityType).toBe('FILE_VERSION');
      expect(input.Item.versionNumber).toBe(4);
      expect(input.Item.uploadedBy).toBe('user-123');
    });

    it('should update FILE entity with new version metadata', async () => {
      setupRestoreVersionMocks();

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      // The UpdateCommand for the FILE entity (5th DynamoDB call)
      const updateCall = mockDocClientSend.mock.calls[4][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;
      expect(input.Key).toEqual({ PK: 'USER#user-123', SK: 'FILE#file-abc' });
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':version']).toBe(4);
      expect(values[':sizeBytes']).toBe(512 * 1024); // from version 2
    });

    it('should invalidate caches after version restore', async () => {
      setupRestoreVersionMocks();

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('user-123');
      expect(mockInvalidateFileCache).toHaveBeenCalledWith('file-abc');
    });

    it('should enforce version cap when at MAX_VERSIONS_PER_FILE', async () => {
      mockDocClientSend.mockReset();
      mockS3Send.mockReset();

      // 1. verifyOwnership
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      // 2. Get VERSION entity
      mockDocClientSend.mockResolvedValueOnce({ Item: versionEntities[1] } as never);
      // 3. enforceVersionCap - count query returns 50 (at limit)
      mockDocClientSend.mockResolvedValueOnce({ Count: 50 } as never);
      // 4. enforceVersionCap - get oldest version
      mockDocClientSend.mockResolvedValueOnce({
        Items: [{
          PK: 'FILE#file-abc',
          SK: 'VERSION#00001',
          versionNumber: 1,
          s3VersionId: 'v1-old',
          uploadedBy: 'user-123',
          fileId: 'file-abc',
        }],
      } as never);
      // 5. enforceVersionCap - delete oldest version record
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // 6. PutCommand for new VERSION entity
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // 7. UpdateCommand for FILE entity
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // S3 calls: delete oldest + copy new
      mockS3Send.mockResolvedValueOnce({}); // delete oldest S3 object
      mockS3Send.mockResolvedValueOnce({ CopyObjectResult: {}, VersionId: 'new-v4' }); // copy

      await service.restoreVersion({ userId: 'user-123', fileId: 'file-abc', versionNumber: 2 });

      // Should have called S3 delete for oldest version
      expect(mockS3Send).toHaveBeenCalledTimes(2);
      // Should have deleted the oldest version record from DynamoDB
      const deleteCall = mockDocClientSend.mock.calls[4][0];
      const deleteInput = (deleteCall as { input: { Key: Record<string, string> } }).input;
      expect(deleteInput.Key.PK).toBe('FILE#file-abc');
      expect(deleteInput.Key.SK).toBe('VERSION#00001');
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should verify file ownership', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never); // update

      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      const firstCall = mockDocClientSend.mock.calls[0][0];
      const input = (firstCall as { input: { Key: Record<string, string> } }).input;
      expect(input.Key.PK).toBe('USER#user-123');
      expect(input.Key.SK).toBe('FILE#file-abc');
    });

    it('should throw FORBIDDEN when user does not own the file', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(
        service.softDelete({ userId: 'user-456', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should throw VALIDATION_ERROR when file is already deleted', async () => {
      const deletedFile = { ...baseFileItem, isDeleted: true };
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFile } as never);

      await expect(
        service.softDelete({ userId: 'user-123', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'File is already deleted',
      });
    });

    it('should set isDeleted=true and deletedAt in DynamoDB', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      const updateCall = mockDocClientSend.mock.calls[1][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;
      expect(input.Key).toEqual({ PK: 'USER#user-123', SK: 'FILE#file-abc' });
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':isDeleted']).toBe(true);
      expect(values[':deletedAt']).toBeDefined();
    });

    it('should add S3 delete marker via DeleteObjectCommand', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const deleteCommand = mockS3Send.mock.calls[0][0];
      const input = (deleteCommand as { input: Record<string, string> }).input;
      expect(input.Key).toBe('users/user-123/files/file-abc/3/document.pdf');
    });

    it('should decrement user storage usage', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockDecrementUsage).toHaveBeenCalledWith('user-123', 1024 * 1024);
    });

    it('should invalidate user and file caches', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('user-123');
      expect(mockInvalidateFileCache).toHaveBeenCalledWith('file-abc');
    });

    it('should gracefully handle S3 delete marker failure', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);
      mockS3Send.mockRejectedValueOnce(new Error('S3 error'));

      // Should not throw
      await service.softDelete({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockDecrementUsage).toHaveBeenCalled();
    });
  });

  // ─── restore ───────────────────────────────────────────────────────────

  describe('restore', () => {
    const deletedFileItem = {
      ...baseFileItem,
      isDeleted: true,
      deletedAt: '2024-01-20T00:00:00.000Z',
    };

    it('should verify file ownership', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      // folder check
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      // update
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      const firstCall = mockDocClientSend.mock.calls[0][0];
      const input = (firstCall as { input: { Key: Record<string, string> } }).input;
      expect(input.Key.PK).toBe('USER#user-123');
      expect(input.Key.SK).toBe('FILE#file-abc');
    });

    it('should throw FORBIDDEN when user does not own the file', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(
        service.restore({ userId: 'user-456', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should throw VALIDATION_ERROR when file is not deleted', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: baseFileItem } as never);

      await expect(
        service.restore({ userId: 'user-123', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'File is not deleted',
      });
    });

    it('should throw QUOTA_EXCEEDED when restoring would exceed quota', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      mockCheckQuota.mockResolvedValueOnce({
        allowed: false,
        currentUsage: 5_368_000_000,
        limit: 5_368_709_120,
      });

      await expect(
        service.restore({ userId: 'user-123', fileId: 'file-abc' }),
      ).rejects.toMatchObject({
        code: ErrorCode.QUOTA_EXCEEDED,
      });
    });

    it('should set isDeleted=false and remove deletedAt in DynamoDB', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      // folder check
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      // update
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      const updateCall = mockDocClientSend.mock.calls[2][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;
      const expression = input.UpdateExpression as string;
      expect(expression).toContain('#isDeleted = :isDeleted');
      expect(expression).toContain('REMOVE #deletedAt');
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':isDeleted']).toBe(false);
    });

    it('should restore to ROOT when original folder is deleted', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      // folder check - folder not found
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);
      // update
      mockDocClientSend.mockResolvedValueOnce({} as never);

      const result = await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.folderId).toBe('ROOT');
      const updateCall = mockDocClientSend.mock.calls[2][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':folderId']).toBe('ROOT');
      expect(values[':gsi2pk']).toBe('FOLDER#ROOT');
    });

    it('should restore to original folder when it still exists', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      // folder check - folder exists
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      // update
      mockDocClientSend.mockResolvedValueOnce({} as never);

      const result = await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.folderId).toBe('folder-abc');
    });

    it('should increment user storage usage on restore', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockIncrementUsage).toHaveBeenCalledWith('user-123', 1024 * 1024);
    });

    it('should remove S3 delete marker', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const deleteCommand = mockS3Send.mock.calls[0][0];
      const input = (deleteCommand as { input: Record<string, string> }).input;
      expect(input.Key).toBe('users/user-123/files/file-abc/3/document.pdf');
    });

    it('should invalidate caches after restore', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('user-123');
      expect(mockInvalidateFileCache).toHaveBeenCalledWith('file-abc');
    });

    it('should return updated file metadata with isDeleted=false', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({ Item: { folderId: 'folder-abc' } } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);

      const result = await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.isDeleted).toBe(false);
      expect(result.deletedAt).toBeUndefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should skip folder check for ROOT folder', async () => {
      const deletedRootFile = { ...deletedFileItem, folderId: 'ROOT' };
      mockDocClientSend.mockResolvedValueOnce({ Item: deletedRootFile } as never);
      // No folder check needed for ROOT
      // update
      mockDocClientSend.mockResolvedValueOnce({} as never);

      const result = await service.restore({ userId: 'user-123', fileId: 'file-abc' });

      expect(result.folderId).toBe('ROOT');
      // Only 2 DynamoDB calls: ownership + update (no folder check)
      expect(mockDocClientSend).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getTrashBin ───────────────────────────────────────────────────────

  describe('getTrashBin', () => {
    const deletedFiles = [
      {
        ...baseFileItem,
        fileId: 'file-1',
        filename: 'deleted1.pdf',
        isDeleted: true,
        deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      },
      {
        ...baseFileItem,
        fileId: 'file-2',
        filename: 'deleted2.pdf',
        isDeleted: true,
        deletedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), // 25 days ago
      },
    ];

    it('should query user files with isDeleted=true filter', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: deletedFiles } as never);

      await service.getTrashBin({ userId: 'user-123' });

      const queryCall = mockDocClientSend.mock.calls[0][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
      expect(input.FilterExpression).toBe('#isDeleted = :isDeleted');
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':pk']).toBe('USER#user-123');
      expect(values[':skPrefix']).toBe('FILE#');
      expect(values[':isDeleted']).toBe(true);
    });

    it('should return trash items with daysRemaining calculated', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: deletedFiles } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].daysRemaining).toBe(25); // 30 - 5
      expect(result.items[1].daysRemaining).toBe(5);  // 30 - 25
    });

    it('should return 0 daysRemaining when past retention period', async () => {
      const expiredFile = [{
        ...baseFileItem,
        fileId: 'file-expired',
        isDeleted: true,
        deletedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
      }];
      mockDocClientSend.mockResolvedValueOnce({ Items: expiredFile } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      expect(result.items[0].daysRemaining).toBe(0);
    });

    it('should use default pagination limit of 20', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] } as never);

      await service.getTrashBin({ userId: 'user-123' });

      const queryCall = mockDocClientSend.mock.calls[0][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.Limit).toBe(20);
    });

    it('should respect custom pagination limit', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] } as never);

      await service.getTrashBin({ userId: 'user-123', pagination: { limit: 10 } });

      const queryCall = mockDocClientSend.mock.calls[0][0];
      const input = (queryCall as { input: Record<string, unknown> }).input;
      expect(input.Limit).toBe(10);
    });

    it('should return hasMore=true when LastEvaluatedKey is present', async () => {
      mockDocClientSend.mockResolvedValueOnce({
        Items: deletedFiles,
        LastEvaluatedKey: { PK: 'USER#user-123', SK: 'FILE#file-3' },
      } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should return hasMore=false when no LastEvaluatedKey', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: deletedFiles } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should return empty items when no deleted files exist', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should include correct fields in trash items', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: deletedFiles } as never);

      const result = await service.getTrashBin({ userId: 'user-123' });

      const item = result.items[0];
      expect(item).toHaveProperty('fileId');
      expect(item).toHaveProperty('filename');
      expect(item).toHaveProperty('mimeType');
      expect(item).toHaveProperty('sizeBytes');
      expect(item).toHaveProperty('deletedAt');
      expect(item).toHaveProperty('daysRemaining');
    });
  });
});
