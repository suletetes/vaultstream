/**
 * FileService Unit Tests — generateUploadUrl & confirmUpload
 *
 * Tests the upload URL generation flow including:
 * - Quota enforcement
 * - KMS data key generation
 * - Presigned URL generation with SSE-KMS headers
 * - DynamoDB metadata storage
 * - Redis upload state tracking
 * - Error handling for quota exceeded and KMS failures
 *
 * Tests the upload confirmation flow including:
 * - DynamoDB metadata fetch and validation
 * - S3 HeadObject verification
 * - DynamoDB update with s3VersionId
 * - Quota increment
 * - EventBridge event publishing
 * - Cache invalidation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { FileService, type RedisLike } from './file-service';
import { EncryptionService } from './encryption-service';
import { AppError, ErrorCode } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock quota-service
vi.mock('./quota-service', () => ({
  enforceQuota: vi.fn(),
  incrementUsage: vi.fn(),
}));

// Mock DynamoDB docClient
vi.mock('../db/dynamodb', () => ({
  docClient: { send: vi.fn().mockResolvedValue({}) },
  TABLE_NAME: 'vaultstream-metadata',
}));

// Mock @aws-sdk/s3-request-presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

import { enforceQuota, incrementUsage } from './quota-service';
import { docClient } from '../db/dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const mockEnforceQuota = vi.mocked(enforceQuota);
const mockIncrementUsage = vi.mocked(incrementUsage);
const mockDocClientSend = vi.mocked(docClient.send);
const mockGetSignedUrl = vi.mocked(getSignedUrl);

// Mock EncryptionService
const mockGenerateDataKey = vi.fn();
const mockEncryptionService = {
  generateDataKey: mockGenerateDataKey,
} as unknown as EncryptionService;

// Mock S3 client
const mockS3Send = vi.fn();
const mockS3Client = { send: mockS3Send } as unknown as S3Client;

// Mock EventBridge client
const mockEventBridgeSend = vi.fn().mockResolvedValue({});
const mockEventBridgeClient = { send: mockEventBridgeSend } as unknown as EventBridgeClient;

// Mock CacheService
const mockInvalidateUserCache = vi.fn().mockResolvedValue(undefined);
const mockCacheService = {
  invalidateUserCache: mockInvalidateUserCache,
  invalidateFileCache: vi.fn(),
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
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisDel = vi.fn().mockResolvedValue(1);
const mockRedisClient: RedisLike = {
  set: mockRedisSet,
  get: mockRedisGet,
  del: mockRedisDel,
};

// ─── Test Setup ─────────────────────────────────────────────────────────────

describe('FileService', () => {
  let service: FileService;

  const validParams = {
    userId: 'user-123',
    filename: 'document.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: 1024 * 1024, // 1MB
    folderId: 'folder-abc',
    tags: ['important', 'work'],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateDataKey.mockResolvedValue({
      plaintextDek: Buffer.alloc(32, 0xab),
      encryptedDek: 'base64-encrypted-dek',
    });

    mockEnforceQuota.mockResolvedValue(undefined);
    mockIncrementUsage.mockResolvedValue(undefined);
    mockDocClientSend.mockResolvedValue({} as never);
    mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/presigned-url');
    mockS3Send.mockResolvedValue({});
    mockEventBridgeSend.mockResolvedValue({});

    service = new FileService({
      encryptionService: mockEncryptionService,
      s3Client: mockS3Client,
      eventBridgeClient: mockEventBridgeClient,
      redisClient: mockRedisClient,
      cacheService: mockCacheService,
    });
  });

  describe('generateUploadUrl', () => {
    it('should return a valid upload URL result with all required fields', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result).toHaveProperty('uploadId');
      expect(result).toHaveProperty('fileId');
      expect(result).toHaveProperty('presignedUrl');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('maxSizeBytes');
      expect(result).toHaveProperty('constraints');
    });

    it('should generate unique fileId and uploadId (ULIDs)', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result.fileId).toHaveLength(26);
      expect(result.uploadId).toHaveLength(26);
      expect(result.fileId).not.toBe(result.uploadId);
    });

    it('should return the presigned URL from S3', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result.presignedUrl).toBe('https://s3.amazonaws.com/presigned-url');
    });

    it('should return correct headers with SSE-KMS encryption', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result.headers['Content-Type']).toBe('application/pdf');
      expect(result.headers['x-amz-server-side-encryption']).toBe('aws:kms');
      expect(result.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBeDefined();
    });

    it('should return correct constraints', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result.constraints.contentType).toBe('application/pdf');
      expect(result.constraints.maxSizeBytes).toBe(1024 * 1024);
      expect(result.constraints.expiresInSeconds).toBe(300);
    });

    it('should return maxSizeBytes matching declared file size', async () => {
      const result = await service.generateUploadUrl(validParams);

      expect(result.maxSizeBytes).toBe(validParams.sizeBytes);
    });

    it('should return a valid ISO8601 expiresAt timestamp in the future', async () => {
      const before = Date.now();
      const result = await service.generateUploadUrl(validParams);
      const expiresAtMs = new Date(result.expiresAt).getTime();

      // Should be approximately 5 minutes in the future
      expect(expiresAtMs).toBeGreaterThan(before);
      expect(expiresAtMs).toBeLessThanOrEqual(before + 300_000 + 1000);
    });

    // ─── Quota Enforcement ────────────────────────────────────────────────

    it('should call enforceQuota with userId and sizeBytes', async () => {
      await service.generateUploadUrl(validParams);

      expect(mockEnforceQuota).toHaveBeenCalledWith('user-123', 1024 * 1024);
    });

    it('should throw QUOTA_EXCEEDED when quota is insufficient', async () => {
      const quotaError = new AppError({
        code: ErrorCode.QUOTA_EXCEEDED,
        message: 'Storage quota exceeded. Current usage: 5000000000 bytes, limit: 5368709120 bytes',
      });
      mockEnforceQuota.mockRejectedValueOnce(quotaError);

      await expect(service.generateUploadUrl(validParams)).rejects.toMatchObject({
        code: ErrorCode.QUOTA_EXCEEDED,
      });
    });

    it('should not generate data key or store metadata when quota is exceeded', async () => {
      mockEnforceQuota.mockRejectedValueOnce(
        new AppError({
          code: ErrorCode.QUOTA_EXCEEDED,
          message: 'Quota exceeded',
        }),
      );

      await expect(service.generateUploadUrl(validParams)).rejects.toThrow();

      expect(mockGenerateDataKey).not.toHaveBeenCalled();
      expect(mockDocClientSend).not.toHaveBeenCalled();
    });

    // ─── Encryption Service ───────────────────────────────────────────────

    it('should call EncryptionService.generateDataKey', async () => {
      await service.generateUploadUrl(validParams);

      expect(mockGenerateDataKey).toHaveBeenCalledTimes(1);
    });

    it('should propagate SERVICE_UNAVAILABLE from EncryptionService', async () => {
      const kmsError = new AppError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'KMS service is throttled, please retry',
        retryAfter: 5,
      });
      mockGenerateDataKey.mockRejectedValueOnce(kmsError);

      await expect(service.generateUploadUrl(validParams)).rejects.toMatchObject({
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });
    });

    // ─── S3 Presigned URL ─────────────────────────────────────────────────

    it('should call getSignedUrl with correct S3 client and expiry', async () => {
      await service.generateUploadUrl(validParams);

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.anything(),
        { expiresIn: 300 },
      );
    });

    // ─── DynamoDB Metadata Storage ────────────────────────────────────────

    it('should store pending file metadata in DynamoDB', async () => {
      await service.generateUploadUrl(validParams);

      expect(mockDocClientSend).toHaveBeenCalledTimes(1);
      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      expect(item.PK).toBe('USER#user-123');
      expect(item.SK).toMatch(/^FILE#/);
      expect(item.entityType).toBe('FILE');
      expect(item.filename).toBe('document.pdf');
      expect(item.mimeType).toBe('application/pdf');
      expect(item.sizeBytes).toBe(1024 * 1024);
      expect(item.encryptedDataKey).toBe('base64-encrypted-dek');
      expect(item.folderId).toBe('folder-abc');
      expect(item.tags).toEqual(['important', 'work']);
      expect(item.version).toBe(1);
      expect(item.isDeleted).toBe(false);
      expect(item.storageClass).toBe('STANDARD');
      expect(item.virusScanStatus).toBe('pending');
      expect(item.thumbnailKey).toBeNull();
      expect(item.s3VersionId).toBe('');
    });

    it('should set GSI keys correctly in DynamoDB item', async () => {
      await service.generateUploadUrl(validParams);

      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      expect(item.GSI1PK).toBe('USER#user-123');
      expect(item.GSI1SK).toBeDefined(); // lastAccessedAt ISO string
      expect(item.GSI2PK).toBe('FOLDER#folder-abc');
      expect(item.GSI2SK).toBe('document.pdf');
    });

    it('should default folderId to ROOT when not provided', async () => {
      const paramsNoFolder = { ...validParams, folderId: undefined };
      await service.generateUploadUrl(paramsNoFolder);

      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      expect(item.folderId).toBe('ROOT');
      expect(item.GSI2PK).toBe('FOLDER#ROOT');
    });

    it('should default tags to empty array when not provided', async () => {
      const paramsNoTags = { ...validParams, tags: undefined };
      await service.generateUploadUrl(paramsNoTags);

      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      expect(item.tags).toEqual([]);
    });

    it('should construct S3 key with correct path structure', async () => {
      await service.generateUploadUrl(validParams);

      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      const s3Key = item.s3Key as string;
      expect(s3Key).toMatch(/^users\/user-123\/files\/[A-Z0-9]{26}\/1\/document\.pdf$/);
    });

    // ─── Redis Upload State ───────────────────────────────────────────────

    it('should store upload state in Redis with 1-hour TTL', async () => {
      await service.generateUploadUrl(validParams);

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const [key, value, mode, duration] = mockRedisSet.mock.calls[0];

      expect(key).toMatch(/^upload:[A-Z0-9]{26}$/);
      expect(mode).toBe('EX');
      expect(duration).toBe(3600);

      const parsed = JSON.parse(value);
      expect(parsed.fileId).toBeDefined();
      expect(parsed.uploadId).toBeDefined();
      expect(parsed.userId).toBe('user-123');
      expect(parsed.filename).toBe('document.pdf');
      expect(parsed.mimeType).toBe('application/pdf');
      expect(parsed.sizeBytes).toBe(1024 * 1024);
    });

    it('should gracefully handle Redis failure without blocking upload', async () => {
      mockRedisSet.mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await service.generateUploadUrl(validParams);

      // Should still return a valid result
      expect(result.fileId).toBeDefined();
      expect(result.presignedUrl).toBeDefined();
    });

    it('should work without Redis client (null)', async () => {
      const serviceNoRedis = new FileService({
        encryptionService: mockEncryptionService,
        s3Client: mockS3Client,
        redisClient: null,
      });

      const result = await serviceNoRedis.generateUploadUrl(validParams);

      expect(result.fileId).toBeDefined();
      expect(result.presignedUrl).toBeDefined();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    // ─── Edge Cases ───────────────────────────────────────────────────────

    it('should sanitize filename for S3 key', async () => {
      const paramsWithSpaces = {
        ...validParams,
        filename: 'my document (final).pdf',
      };
      await service.generateUploadUrl(paramsWithSpaces);

      const putCommand = mockDocClientSend.mock.calls[0][0];
      const item = (putCommand as { input: { Item: Record<string, unknown> } }).input.Item;

      const s3Key = item.s3Key as string;
      // sanitizeFilename preserves spaces and parentheses
      expect(s3Key).toContain('my document (final).pdf');
    });

    it('should generate different fileIds for consecutive calls', async () => {
      const result1 = await service.generateUploadUrl(validParams);
      const result2 = await service.generateUploadUrl(validParams);

      expect(result1.fileId).not.toBe(result2.fileId);
      expect(result1.uploadId).not.toBe(result2.uploadId);
    });
  });

  describe('confirmUpload', () => {
    const pendingFileItem = {
      PK: 'USER#user-123',
      SK: 'FILE#file-abc',
      entityType: 'FILE',
      fileId: 'file-abc',
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024 * 1024,
      s3Key: 'users/user-123/files/file-abc/1/document.pdf',
      s3VersionId: '',
      encryptedDataKey: 'base64-encrypted-dek',
      kmsKeyId: 'arn:aws:kms:us-east-1:123456789:key/test-key',
      thumbnailKey: null,
      folderId: 'ROOT',
      tags: [],
      storageClass: 'STANDARD',
      virusScanStatus: 'pending',
      version: 1,
      isDeleted: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastAccessedAt: '2024-01-01T00:00:00.000Z',
      GSI1PK: 'USER#user-123',
      GSI1SK: '2024-01-01T00:00:00.000Z',
      GSI2PK: 'FOLDER#ROOT',
      GSI2SK: 'document.pdf',
    };

    const confirmParams = {
      userId: 'user-123',
      fileId: 'file-abc',
      etag: '"abc123etag"',
      s3VersionId: 'version-xyz',
    };

    function setupHappyPathMocks() {
      mockDocClientSend.mockReset();
      mockS3Send.mockReset();
      mockEventBridgeSend.mockReset();
      mockIncrementUsage.mockReset();
      mockInvalidateUserCache.mockReset();

      // DynamoDB GetCommand returns the pending file
      mockDocClientSend.mockResolvedValueOnce({ Item: pendingFileItem } as never);
      // DynamoDB UpdateCommand succeeds
      mockDocClientSend.mockResolvedValueOnce({} as never);
      // S3 HeadObject returns matching ETag
      mockS3Send.mockResolvedValue({ ETag: '"abc123etag"' });
      // EventBridge succeeds
      mockEventBridgeSend.mockResolvedValue({});
      // incrementUsage succeeds
      mockIncrementUsage.mockResolvedValue(undefined);
      // cache invalidation succeeds
      mockInvalidateUserCache.mockResolvedValue(undefined);
    }

    beforeEach(() => {
      setupHappyPathMocks();
    });

    it('should return updated file metadata with s3VersionId set', async () => {
      const result = await service.confirmUpload(confirmParams);

      expect(result.fileId).toBe('file-abc');
      expect(result.s3VersionId).toBe('version-xyz');
      expect(result.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should fetch file metadata from DynamoDB with correct keys', async () => {
      await service.confirmUpload(confirmParams);

      const getCall = mockDocClientSend.mock.calls[0][0];
      const input = (getCall as { input: { Key: Record<string, string> } }).input;
      expect(input.Key.PK).toBe('USER#user-123');
      expect(input.Key.SK).toBe('FILE#file-abc');
    });

    it('should throw VALIDATION_ERROR when file is not found', async () => {
      mockDocClientSend.mockReset();
      mockDocClientSend.mockResolvedValueOnce({ Item: undefined } as never);

      await expect(service.confirmUpload(confirmParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Upload confirmation is invalid',
      });
    });

    it('should throw VALIDATION_ERROR when virusScanStatus is not pending', async () => {
      const activeFile = { ...pendingFileItem, virusScanStatus: 'clean' };
      mockDocClientSend.mockReset();
      mockDocClientSend.mockResolvedValueOnce({ Item: activeFile } as never);

      await expect(service.confirmUpload(confirmParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Upload confirmation is invalid',
      });
    });

    it('should call S3 HeadObject with correct bucket, key, and versionId', async () => {
      await service.confirmUpload(confirmParams);

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const headCommand = mockS3Send.mock.calls[0][0];
      const input = (headCommand as { input: Record<string, string> }).input;
      expect(input.Key).toBe('users/user-123/files/file-abc/1/document.pdf');
      expect(input.VersionId).toBe('version-xyz');
    });

    it('should throw VALIDATION_ERROR when S3 ETag does not match', async () => {
      mockS3Send.mockResolvedValueOnce({ ETag: '"different-etag"' });

      await expect(service.confirmUpload(confirmParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Upload confirmation is invalid - S3 object verification failed',
      });
    });

    it('should throw VALIDATION_ERROR when S3 HeadObject fails (object not found)', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('NoSuchKey'));

      await expect(service.confirmUpload(confirmParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Upload confirmation is invalid - S3 object verification failed',
      });
    });

    it('should normalize ETags for comparison (strip quotes)', async () => {
      // ETag without quotes in params, S3 returns with quotes
      mockS3Send.mockResolvedValueOnce({ ETag: '"abc123etag"' });
      const paramsNoQuotes = { ...confirmParams, etag: 'abc123etag' };

      const result = await service.confirmUpload(paramsNoQuotes);
      expect(result.fileId).toBe('file-abc');
    });

    it('should update DynamoDB with s3VersionId and updatedAt', async () => {
      await service.confirmUpload(confirmParams);

      // Second call to docClient.send is the UpdateCommand
      const updateCall = mockDocClientSend.mock.calls[1][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;
      expect(input).toMatchObject({
        Key: { PK: 'USER#user-123', SK: 'FILE#file-abc' },
        UpdateExpression: 'SET #s3VersionId = :s3VersionId, #updatedAt = :updatedAt',
      });
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[':s3VersionId']).toBe('version-xyz');
      expect(values[':updatedAt']).toBeDefined();
    });

    it('should call incrementUsage with userId and file sizeBytes', async () => {
      await service.confirmUpload(confirmParams);

      expect(mockIncrementUsage).toHaveBeenCalledWith('user-123', 1024 * 1024);
    });

    it('should publish FileUploaded event to EventBridge', async () => {
      await service.confirmUpload(confirmParams);

      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const putEventsCommand = mockEventBridgeSend.mock.calls[0][0];
      const input = (putEventsCommand as { input: { Entries: Array<Record<string, unknown>> } }).input;
      const entry = input.Entries[0];

      expect(entry.Source).toBe('vaultstream.api');
      expect(entry.DetailType).toBe('FileUploaded');

      const detail = JSON.parse(entry.Detail as string);
      expect(detail.fileId).toBe('file-abc');
      expect(detail.userId).toBe('user-123');
      expect(detail.s3Key).toBe('users/user-123/files/file-abc/1/document.pdf');
      expect(detail.mimeType).toBe('application/pdf');
      expect(detail.sizeBytes).toBe(1024 * 1024);
    });

    it('should invalidate user cache via CacheService', async () => {
      await service.confirmUpload(confirmParams);

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('user-123');
    });

    it('should gracefully handle cache invalidation failure', async () => {
      mockInvalidateUserCache.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.confirmUpload(confirmParams);

      // Should still return successfully
      expect(result.fileId).toBe('file-abc');
    });

    it('should work without CacheService (null)', async () => {
      const serviceNoCache = new FileService({
        encryptionService: mockEncryptionService,
        s3Client: mockS3Client,
        eventBridgeClient: mockEventBridgeClient,
        redisClient: mockRedisClient,
        cacheService: null,
      });

      // Reset mocks for this test
      mockDocClientSend.mockReset();
      mockDocClientSend.mockResolvedValueOnce({ Item: pendingFileItem } as never);
      mockDocClientSend.mockResolvedValueOnce({} as never);
      mockS3Send.mockResolvedValueOnce({ ETag: '"abc123etag"' });

      const result = await serviceNoCache.confirmUpload(confirmParams);

      expect(result.fileId).toBe('file-abc');
      expect(mockInvalidateUserCache).not.toHaveBeenCalled();
    });
  });

  describe('generateDownloadUrl', () => {
    const baseFileMetadata = {
      PK: 'USER#user-123' as const,
      SK: 'FILE#file-abc' as const,
      entityType: 'FILE' as const,
      fileId: 'file-abc',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      s3Key: 'users/user-123/files/file-abc/1/report.pdf',
      s3VersionId: 'v1',
      encryptedDataKey: 'base64-dek',
      kmsKeyId: 'arn:aws:kms:us-east-1:123:key/test',
      thumbnailKey: null,
      folderId: 'ROOT',
      tags: [],
      storageClass: 'STANDARD' as const,
      virusScanStatus: 'clean' as const,
      version: 1,
      isDeleted: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastAccessedAt: '2024-01-01T00:00:00.000Z',
      GSI1PK: 'USER#user-123' as const,
      GSI1SK: '2024-01-01T00:00:00.000Z',
      GSI2PK: 'FOLDER#ROOT' as const,
      GSI2SK: 'report.pdf',
    };

    const ownerParams = {
      userId: 'user-123',
      fileId: 'file-abc',
      fileMetadata: baseFileMetadata,
      isOwner: true,
    };

    const sharedParams = {
      userId: 'user-456',
      fileId: 'file-abc',
      fileMetadata: baseFileMetadata,
      isOwner: false,
    };

    // ─── Eligibility Gates ──────────────────────────────────────────────

    it('should throw FILE_INFECTED when virusScanStatus is infected', async () => {
      const infectedFile = { ...baseFileMetadata, virusScanStatus: 'infected' as const };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: infectedFile }),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_INFECTED,
      });
    });

    it('should throw VALIDATION_ERROR when virusScanStatus is pending', async () => {
      const pendingFile = { ...baseFileMetadata, virusScanStatus: 'pending' as const };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: pendingFile }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'File is still being scanned',
      });
    });

    it('should throw VALIDATION_ERROR when virusScanStatus is error', async () => {
      const errorFile = { ...baseFileMetadata, virusScanStatus: 'error' as const };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: errorFile }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'File is still being scanned',
      });
    });

    it('should throw FILE_NOT_FOUND when file is soft-deleted', async () => {
      const deletedFile = { ...baseFileMetadata, isDeleted: true };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: deletedFile }),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should throw VALIDATION_ERROR when storageClass is DEEP_ARCHIVE', async () => {
      const archivedFile = { ...baseFileMetadata, storageClass: 'DEEP_ARCHIVE' as const };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: archivedFile }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'File must be restored before download. Estimated restore time: 12 hours',
      });
    });

    it('should allow download when virusScanStatus is skipped', async () => {
      const skippedFile = { ...baseFileMetadata, virusScanStatus: 'skipped' as const };

      const result = await service.generateDownloadUrl({ ...ownerParams, fileMetadata: skippedFile });

      expect(result.downloadUrl).toBeDefined();
      expect(result.filename).toBe('report.pdf');
    });

    it('should not call getSignedUrl or update DynamoDB when eligibility gate fails', async () => {
      const infectedFile = { ...baseFileMetadata, virusScanStatus: 'infected' as const };

      await expect(
        service.generateDownloadUrl({ ...ownerParams, fileMetadata: infectedFile }),
      ).rejects.toThrow();

      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(mockDocClientSend).not.toHaveBeenCalled();
    });

    // ─── Owner Path (Presigned S3 GET URL) ──────────────────────────────

    it('should generate presigned S3 GET URL for owner with 15-minute expiry', async () => {
      const result = await service.generateDownloadUrl(ownerParams);

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.anything(),
        { expiresIn: 900 },
      );
      expect(result.downloadUrl).toBe('https://s3.amazonaws.com/presigned-url');
    });

    it('should set ResponseContentDisposition with original filename for owner', async () => {
      await service.generateDownloadUrl(ownerParams);

      const getCommand = mockGetSignedUrl.mock.calls[0][1];
      const input = (getCommand as { input: Record<string, string> }).input;
      expect(input.ResponseContentDisposition).toBe('attachment; filename="report.pdf"');
    });

    it('should use correct S3 key from file metadata for owner download', async () => {
      await service.generateDownloadUrl(ownerParams);

      const getCommand = mockGetSignedUrl.mock.calls[0][1];
      const input = (getCommand as { input: Record<string, string> }).input;
      expect(input.Key).toBe('users/user-123/files/file-abc/1/report.pdf');
    });

    it('should return expiresAt approximately 15 minutes in the future for owner', async () => {
      const before = Date.now();
      const result = await service.generateDownloadUrl(ownerParams);
      const expiresAtMs = new Date(result.expiresAt).getTime();

      expect(expiresAtMs).toBeGreaterThan(before);
      expect(expiresAtMs).toBeLessThanOrEqual(before + 900_000 + 1000);
    });

    // ─── Shared User Path (CloudFront Signed URL) ───────────────────────

    it('should generate CloudFront signed URL for shared user', async () => {
      const result = await service.generateDownloadUrl(sharedParams);

      expect(result.downloadUrl).toContain('https://cdn.vaultstream.io/');
      expect(result.downloadUrl).toContain(baseFileMetadata.s3Key);
      expect(result.downloadUrl).toContain('Expires=');
      expect(result.downloadUrl).toContain('Signature=');
      expect(result.downloadUrl).toContain('Key-Pair-Id=');
    });

    it('should not call getSignedUrl for shared user (uses CloudFront)', async () => {
      await service.generateDownloadUrl(sharedParams);

      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('should return expiresAt approximately 1 hour in the future for shared user', async () => {
      const before = Date.now();
      const result = await service.generateDownloadUrl(sharedParams);
      const expiresAtMs = new Date(result.expiresAt).getTime();

      expect(expiresAtMs).toBeGreaterThan(before);
      expect(expiresAtMs).toBeLessThanOrEqual(before + 3_600_000 + 1000);
    });

    // ─── DynamoDB lastAccessedAt Update ─────────────────────────────────

    it('should update lastAccessedAt in DynamoDB after generating URL', async () => {
      await service.generateDownloadUrl(ownerParams);

      expect(mockDocClientSend).toHaveBeenCalledTimes(1);
      const updateCall = mockDocClientSend.mock.calls[0][0];
      const input = (updateCall as { input: Record<string, unknown> }).input;

      expect(input).toMatchObject({
        Key: { PK: 'USER#user-123', SK: 'FILE#file-abc' },
      });
      const expression = input.UpdateExpression as string;
      expect(expression).toContain('#lastAccessedAt');
      expect(expression).toContain('#updatedAt');
      expect(expression).toContain('#gsi1sk');
    });

    it('should gracefully handle DynamoDB update failure without blocking download', async () => {
      mockDocClientSend.mockRejectedValueOnce(new Error('DynamoDB throttled'));

      const result = await service.generateDownloadUrl(ownerParams);

      expect(result.downloadUrl).toBeDefined();
      expect(result.filename).toBe('report.pdf');
    });

    // ─── Cache Invalidation ─────────────────────────────────────────────

    it('should invalidate user recent files cache after generating URL', async () => {
      await service.generateDownloadUrl(ownerParams);

      expect(mockRedisDel).toHaveBeenCalledWith('user:user-123:recent');
    });

    it('should invalidate shared user cache when shared user downloads', async () => {
      await service.generateDownloadUrl(sharedParams);

      expect(mockRedisDel).toHaveBeenCalledWith('user:user-456:recent');
    });

    it('should gracefully handle Redis cache invalidation failure', async () => {
      mockRedisDel.mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await service.generateDownloadUrl(ownerParams);

      expect(result.downloadUrl).toBeDefined();
    });

    it('should work without Redis client (null)', async () => {
      const serviceNoRedis = new FileService({
        encryptionService: mockEncryptionService,
        s3Client: mockS3Client,
        eventBridgeClient: mockEventBridgeClient,
        redisClient: null,
        cacheService: null,
      });

      const result = await serviceNoRedis.generateDownloadUrl(ownerParams);

      expect(result.downloadUrl).toBeDefined();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    // ─── Return Value ───────────────────────────────────────────────────

    it('should return correct filename and contentType from file metadata', async () => {
      const result = await service.generateDownloadUrl(ownerParams);

      expect(result.filename).toBe('report.pdf');
      expect(result.contentType).toBe('application/pdf');
    });

    it('should return all required fields in the result', async () => {
      const result = await service.generateDownloadUrl(ownerParams);

      expect(result).toHaveProperty('downloadUrl');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('contentType');
    });

    it('should return valid ISO8601 expiresAt timestamp', async () => {
      const result = await service.generateDownloadUrl(ownerParams);

      const parsed = new Date(result.expiresAt);
      expect(parsed.toISOString()).toBe(result.expiresAt);
    });
  });
});
