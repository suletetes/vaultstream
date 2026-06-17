/**
 * ShareService Unit Tests
 *
 * Tests the share management flow including:
 * - Email resolution to userId
 * - Self-sharing prevention
 * - Share count limit enforcement
 * - Share creation with optional expiry
 * - Share revocation
 * - Permission updates
 * - Shared-with-me queries with caching
 * - Listing shares for a file
 * - EventBridge event publishing
 * - Cache invalidation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { ShareService } from './share-service';
import { AppError, ErrorCode } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';
import type { ShareEntity } from '@vaultstream/shared';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock DynamoDB docClient
vi.mock('../db/dynamodb', () => ({
  docClient: { send: vi.fn().mockResolvedValue({}) },
  TABLE_NAME: 'vaultstream-metadata',
}));

// Mock base-repository
vi.mock('../db/base-repository', () => ({
  queryItems: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
  putItem: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  updateItem: vi.fn().mockResolvedValue(undefined),
  getItem: vi.fn().mockResolvedValue({ PK: 'USER#owner-123', SK: 'FILE#file-abc' }),
}));

import { docClient } from '../db/dynamodb';
import { queryItems, putItem, deleteItem, updateItem, getItem } from '../db/base-repository';

const mockDocClientSend = vi.mocked(docClient.send);
const mockQueryItems = vi.mocked(queryItems);
const mockPutItem = vi.mocked(putItem);
const mockDeleteItem = vi.mocked(deleteItem);
const mockUpdateItem = vi.mocked(updateItem);
const mockGetItem = vi.mocked(getItem);

// Mock EventBridge client
const mockEventBridgeSend = vi.fn().mockResolvedValue({});
const mockEventBridgeClient = { send: mockEventBridgeSend } as unknown as EventBridgeClient;

// Mock CacheService
const mockInvalidateUserCache = vi.fn().mockResolvedValue(undefined);
const mockGetSharedWithMe = vi.fn().mockResolvedValue(null);
const mockSetSharedWithMe = vi.fn().mockResolvedValue(undefined);
const mockCacheService = {
  invalidateUserCache: mockInvalidateUserCache,
  invalidateFileCache: vi.fn(),
  invalidateFolderCache: vi.fn(),
  getRecentFiles: vi.fn(),
  setRecentFiles: vi.fn(),
  getSharedWithMe: mockGetSharedWithMe,
  setSharedWithMe: mockSetSharedWithMe,
  getFileMetadata: vi.fn(),
  setFileMetadata: vi.fn(),
  getFolderContents: vi.fn(),
  setFolderContents: vi.fn(),
  isAvailable: vi.fn().mockReturnValue(true),
} as unknown as CacheService;

// ─── Test Setup ─────────────────────────────────────────────────────────────

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new ShareService({
      eventBridgeClient: mockEventBridgeClient,
      cacheService: mockCacheService,
    });

    // Default: email resolution returns a valid user
    mockDocClientSend.mockResolvedValue({
      Items: [{ PK: 'USER#target-user-456', SK: 'PROFILE#target-user-456', email: 'target@example.com' }],
    } as never);

    // Default: no existing shares
    mockQueryItems.mockResolvedValue({ items: [], lastEvaluatedKey: undefined });
  });

  // ─── createShare ────────────────────────────────────────────────────────

  describe('createShare', () => {
    const validParams = {
      ownerId: 'owner-123',
      fileId: 'file-abc',
      targetEmail: 'target@example.com',
      permissions: 'view' as const,
    };

    it('should create a share and return the share entity', async () => {
      const result = await service.createShare(validParams);

      expect(result.entityType).toBe('SHARE');
      expect(result.PK).toBe('FILE#file-abc');
      expect(result.SK).toBe('SHARE#target-user-456');
      expect(result.fileId).toBe('file-abc');
      expect(result.sharedBy).toBe('owner-123');
      expect(result.sharedWith).toBe('target-user-456');
      expect(result.permissions).toBe('view');
      expect(result.sharedAt).toBeDefined();
      expect(result.GSI3PK).toBe('USER#target-user-456');
      expect(result.GSI3SK).toBeDefined();
    });

    it('should store the share entity in DynamoDB via putItem', async () => {
      await service.createShare(validParams);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      const storedItem = mockPutItem.mock.calls[0][0] as ShareEntity;
      expect(storedItem.PK).toBe('FILE#file-abc');
      expect(storedItem.SK).toBe('SHARE#target-user-456');
      expect(storedItem.entityType).toBe('SHARE');
    });

    it('should resolve targetEmail to userId via DynamoDB GSI1 query', async () => {
      await service.createShare(validParams);

      expect(mockDocClientSend).toHaveBeenCalledTimes(1);
      const queryCommand = mockDocClientSend.mock.calls[0][0];
      const input = (queryCommand as { input: Record<string, unknown> }).input;
      expect(input.IndexName).toBe('GSI1');
      expect(input.FilterExpression).toBe('email = :email');
    });

    it('should throw VALIDATION_ERROR when target email is not found', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] } as never);

      await expect(service.createShare(validParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Target user was not found',
      });
    });

    it('should throw VALIDATION_ERROR when target email returns no items', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: undefined } as never);

      await expect(service.createShare(validParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Target user was not found',
      });
    });

    it('should throw VALIDATION_ERROR when sharing with yourself', async () => {
      // Resolve email to the same user as owner
      mockDocClientSend.mockResolvedValueOnce({
        Items: [{ PK: 'USER#owner-123', SK: 'PROFILE#owner-123', email: 'owner@example.com' }],
      } as never);

      const selfShareParams = {
        ...validParams,
        targetEmail: 'owner@example.com',
      };

      await expect(service.createShare(selfShareParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot share a file with yourself',
      });
    });

    it('should throw VALIDATION_ERROR when max shares per file is exceeded', async () => {
      // Return 50 existing shares
      const existingShares = Array.from({ length: 50 }, (_, i) => ({
        PK: `FILE#file-abc`,
        SK: `SHARE#user-${i}`,
        entityType: 'SHARE',
        fileId: 'file-abc',
        sharedBy: 'owner-123',
        sharedWith: `user-${i}`,
        permissions: 'view',
        sharedAt: new Date().toISOString(),
        GSI3PK: `USER#user-${i}`,
        GSI3SK: new Date().toISOString(),
      }));

      mockQueryItems.mockResolvedValueOnce({ items: existingShares, lastEvaluatedKey: undefined });

      await expect(service.createShare(validParams)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Maximum shares per file exceeded',
      });
    });

    it('should not store share when max shares limit is reached', async () => {
      const existingShares = Array.from({ length: 50 }, (_, i) => ({
        PK: `FILE#file-abc`,
        SK: `SHARE#user-${i}`,
        entityType: 'SHARE',
      }));

      mockQueryItems.mockResolvedValueOnce({ items: existingShares, lastEvaluatedKey: undefined });

      await expect(service.createShare(validParams)).rejects.toThrow();
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should set expiresAt when expiresInHours is provided', async () => {
      const before = Math.floor(Date.now() / 1000);

      const result = await service.createShare({
        ...validParams,
        expiresInHours: 24,
      });

      const after = Math.floor(Date.now() / 1000);
      const expectedMin = before + 24 * 3600;
      const expectedMax = after + 24 * 3600;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('should not set expiresAt when expiresInHours is not provided', async () => {
      const result = await service.createShare(validParams);

      expect(result.expiresAt).toBeUndefined();
    });

    it('should publish FileShared event to EventBridge', async () => {
      await service.createShare(validParams);

      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
      const putEventsCommand = mockEventBridgeSend.mock.calls[0][0];
      const input = (putEventsCommand as { input: { Entries: Array<Record<string, unknown>> } }).input;
      const entry = input.Entries[0];

      expect(entry.Source).toBe('vaultstream.api');
      expect(entry.DetailType).toBe('FileShared');

      const detail = JSON.parse(entry.Detail as string);
      expect(detail.fileId).toBe('file-abc');
      expect(detail.sharedBy).toBe('owner-123');
      expect(detail.sharedWith).toBe('target-user-456');
      expect(detail.permissions).toBe('view');
    });

    it('should include message in EventBridge event when provided', async () => {
      await service.createShare({
        ...validParams,
        message: 'Please review this document',
      });

      const putEventsCommand = mockEventBridgeSend.mock.calls[0][0];
      const input = (putEventsCommand as { input: { Entries: Array<Record<string, unknown>> } }).input;
      const detail = JSON.parse(input.Entries[0].Detail as string);
      expect(detail.message).toBe('Please review this document');
    });

    it('should invalidate target user shared cache', async () => {
      await service.createShare(validParams);

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('target-user-456');
    });

    it('should gracefully handle EventBridge failure without blocking share creation', async () => {
      mockEventBridgeSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

      const result = await service.createShare(validParams);

      expect(result.entityType).toBe('SHARE');
      expect(result.fileId).toBe('file-abc');
    });

    it('should gracefully handle cache invalidation failure', async () => {
      mockInvalidateUserCache.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.createShare(validParams);

      expect(result.entityType).toBe('SHARE');
    });

    it('should set GSI3 keys for shared-with-me query pattern', async () => {
      const result = await service.createShare(validParams);

      expect(result.GSI3PK).toBe('USER#target-user-456');
      expect(result.GSI3SK).toBe(result.sharedAt);
    });

    it('should create share with edit permissions', async () => {
      const result = await service.createShare({
        ...validParams,
        permissions: 'edit',
      });

      expect(result.permissions).toBe('edit');
    });

    it('should create share with download permissions', async () => {
      const result = await service.createShare({
        ...validParams,
        permissions: 'download',
      });

      expect(result.permissions).toBe('download');
    });
  });

  // ─── revokeShare ──────────────────────────────────────────────────────────

  describe('revokeShare', () => {
    const revokeParams = {
      ownerId: 'owner-123',
      fileId: 'file-abc',
      targetUserId: 'target-user-456',
    };

    it('should delete the share entity from DynamoDB', async () => {
      await service.revokeShare(revokeParams);

      expect(mockDeleteItem).toHaveBeenCalledWith('FILE#file-abc', 'SHARE#target-user-456');
    });

    it('should invalidate target user shared cache', async () => {
      await service.revokeShare(revokeParams);

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('target-user-456');
    });

    it('should gracefully handle cache invalidation failure', async () => {
      mockInvalidateUserCache.mockRejectedValueOnce(new Error('Redis down'));

      // Should not throw
      await expect(service.revokeShare(revokeParams)).resolves.toBeUndefined();
    });
  });

  // ─── updatePermissions ────────────────────────────────────────────────────

  describe('updatePermissions', () => {
    const updateParams = {
      ownerId: 'owner-123',
      fileId: 'file-abc',
      targetUserId: 'target-user-456',
      permissions: 'edit' as const,
    };

    it('should update only the permissions attribute', async () => {
      await service.updatePermissions(updateParams);

      expect(mockUpdateItem).toHaveBeenCalledWith(
        'FILE#file-abc',
        'SHARE#target-user-456',
        { permissions: 'edit' },
      );
    });

    it('should invalidate target user shared cache', async () => {
      await service.updatePermissions(updateParams);

      expect(mockInvalidateUserCache).toHaveBeenCalledWith('target-user-456');
    });

    it('should not update sharedAt or expiresAt', async () => {
      await service.updatePermissions(updateParams);

      const updateCall = mockUpdateItem.mock.calls[0];
      const updates = updateCall[2] as Record<string, unknown>;
      expect(updates).toEqual({ permissions: 'edit' });
      expect(updates).not.toHaveProperty('sharedAt');
      expect(updates).not.toHaveProperty('expiresAt');
    });

    it('should gracefully handle cache invalidation failure', async () => {
      mockInvalidateUserCache.mockRejectedValueOnce(new Error('Redis down'));

      await expect(service.updatePermissions(updateParams)).resolves.toBeUndefined();
    });
  });

  // ─── getSharedWithMe ──────────────────────────────────────────────────────

  describe('getSharedWithMe', () => {
    const sharedParams = { userId: 'user-123' };

    it('should return cached results when available', async () => {
      const cachedShares: ShareEntity[] = [
        {
          PK: 'FILE#file-1',
          SK: 'SHARE#user-123',
          entityType: 'SHARE',
          fileId: 'file-1',
          sharedBy: 'owner-1',
          sharedWith: 'user-123',
          permissions: 'view',
          sharedAt: '2024-01-01T00:00:00.000Z',
          GSI3PK: 'USER#user-123',
          GSI3SK: '2024-01-01T00:00:00.000Z',
        },
      ];
      mockGetSharedWithMe.mockResolvedValueOnce(cachedShares);

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].fileId).toBe('file-1');
      // Should not query DynamoDB when cache hit
      expect(mockQueryItems).not.toHaveBeenCalled();
    });

    it('should query GSI3 on cache miss', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-1',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-1',
            sharedBy: 'owner-1',
            sharedWith: 'user-123',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(1);
      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          indexName: 'GSI3',
          keyConditionExpression: 'GSI3PK = :gsi3pk',
          expressionAttributeValues: { ':gsi3pk': 'USER#user-123' },
          scanIndexForward: false,
          limit: 20,
        }),
      );
    });

    it('should filter out expired shares', async () => {
      const pastEpoch = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-1',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-1',
            sharedBy: 'owner-1',
            sharedWith: 'user-123',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            expiresAt: pastEpoch,
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
          {
            PK: 'FILE#file-2',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-2',
            sharedBy: 'owner-2',
            sharedWith: 'user-123',
            permissions: 'download',
            sharedAt: '2024-01-02T00:00:00.000Z',
            expiresAt: futureEpoch,
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-02T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].fileId).toBe('file-2');
    });

    it('should include shares without expiresAt (no expiry)', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-1',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-1',
            sharedBy: 'owner-1',
            sharedWith: 'user-123',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            // No expiresAt — never expires
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(1);
    });

    it('should populate cache on miss', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-1',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-1',
            sharedBy: 'owner-1',
            sharedWith: 'user-123',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      await service.getSharedWithMe(sharedParams);

      expect(mockSetSharedWithMe).toHaveBeenCalledWith('user-123', expect.any(Array));
    });

    it('should not populate cache when results are empty', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getSharedWithMe(sharedParams);

      expect(mockSetSharedWithMe).not.toHaveBeenCalled();
    });

    it('should return hasMore=true when lastEvaluatedKey is present', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-1',
            SK: 'SHARE#user-123',
            entityType: 'SHARE',
            fileId: 'file-1',
            sharedBy: 'owner-1',
            sharedWith: 'user-123',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            GSI3PK: 'USER#user-123',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: { GSI3PK: 'USER#user-123', GSI3SK: '2024-01-01T00:00:00.000Z' },
      });

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should return hasMore=false when no lastEvaluatedKey', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should use custom limit from pagination params', async () => {
      mockGetSharedWithMe.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getSharedWithMe({ userId: 'user-123', pagination: { limit: 10 } });

      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('should skip cache check when cursor is provided', async () => {
      const cursor = Buffer.from(JSON.stringify({ GSI3PK: 'USER#user-123', GSI3SK: '2024-01-01' })).toString('base64url');
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getSharedWithMe({ userId: 'user-123', pagination: { cursor } });

      expect(mockGetSharedWithMe).not.toHaveBeenCalled();
    });

    it('should work without CacheService (null)', async () => {
      const serviceNoCache = new ShareService({
        eventBridgeClient: mockEventBridgeClient,
        cacheService: null,
      });

      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await serviceNoCache.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(0);
      expect(mockGetSharedWithMe).not.toHaveBeenCalled();
    });

    it('should filter expired shares from cache results', async () => {
      const pastEpoch = Math.floor(Date.now() / 1000) - 3600;
      const cachedShares: ShareEntity[] = [
        {
          PK: 'FILE#file-1',
          SK: 'SHARE#user-123',
          entityType: 'SHARE',
          fileId: 'file-1',
          sharedBy: 'owner-1',
          sharedWith: 'user-123',
          permissions: 'view',
          sharedAt: '2024-01-01T00:00:00.000Z',
          expiresAt: pastEpoch,
          GSI3PK: 'USER#user-123',
          GSI3SK: '2024-01-01T00:00:00.000Z',
        },
      ];
      mockGetSharedWithMe.mockResolvedValueOnce(cachedShares);

      const result = await service.getSharedWithMe(sharedParams);

      expect(result.items).toHaveLength(0);
    });
  });

  // ─── listSharesForFile ────────────────────────────────────────────────────

  describe('listSharesForFile', () => {
    it('should query shares by file PK and SHARE# prefix', async () => {
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'FILE#file-abc',
            SK: 'SHARE#user-1',
            entityType: 'SHARE',
            fileId: 'file-abc',
            sharedBy: 'owner-123',
            sharedWith: 'user-1',
            permissions: 'view',
            sharedAt: '2024-01-01T00:00:00.000Z',
            GSI3PK: 'USER#user-1',
            GSI3SK: '2024-01-01T00:00:00.000Z',
          },
          {
            PK: 'FILE#file-abc',
            SK: 'SHARE#user-2',
            entityType: 'SHARE',
            fileId: 'file-abc',
            sharedBy: 'owner-123',
            sharedWith: 'user-2',
            permissions: 'edit',
            sharedAt: '2024-01-02T00:00:00.000Z',
            GSI3PK: 'USER#user-2',
            GSI3SK: '2024-01-02T00:00:00.000Z',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.listSharesForFile({ fileId: 'file-abc', ownerId: 'owner-123' });

      expect(result).toHaveLength(2);
      expect(result[0].sharedWith).toBe('user-1');
      expect(result[1].sharedWith).toBe('user-2');
    });

    it('should query with correct key condition expression', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.listSharesForFile({ fileId: 'file-abc', ownerId: 'owner-123' });

      expect(mockQueryItems).toHaveBeenCalledWith({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        expressionAttributeValues: {
          ':pk': 'FILE#file-abc',
          ':skPrefix': 'SHARE#',
        },
      });
    });

    it('should return empty array when no shares exist', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.listSharesForFile({ fileId: 'file-abc', ownerId: 'owner-123' });

      expect(result).toHaveLength(0);
    });
  });
});
