/**
 * NotificationService Unit Tests
 *
 * Tests the notification and activity feed flow including:
 * - Share notification sending with deduplication
 * - Activity recording with max event enforcement
 * - Quota warning with 24-hour deduplication
 * - Activity feed retrieval with pagination
 *
 * Validates: Requirements 22.1-22.7, 39.1-39.6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SNSClient } from '@aws-sdk/client-sns';
import { NotificationService } from './notification-service';
import type { ActivityEntity } from './notification-service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock base-repository
vi.mock('../db/base-repository', () => ({
  queryItems: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
  putItem: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
}));

import { queryItems, putItem, deleteItem } from '../db/base-repository';

const mockQueryItems = vi.mocked(queryItems);
const mockPutItem = vi.mocked(putItem);
const mockDeleteItem = vi.mocked(deleteItem);

// Mock SNS client
const mockSnsSend = vi.fn().mockResolvedValue({ MessageId: 'msg-123' });
const mockSnsClient = { send: mockSnsSend } as unknown as SNSClient;

// Mock Redis client
const mockRedisExists = vi.fn().mockResolvedValue(0);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedis = {
  exists: mockRedisExists,
  set: mockRedisSet,
} as unknown as import('ioredis').default;

// ─── Test Setup ─────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new NotificationService({
      snsClient: mockSnsClient,
      redis: mockRedis,
      topicArn: 'arn:aws:sns:us-east-1:123456789:vaultstream-notifications',
    });
  });

  // ─── sendShareNotification ──────────────────────────────────────────────

  describe('sendShareNotification', () => {
    const shareParams = {
      sharedBy: 'user-alice',
      sharedWith: 'user-bob',
      fileId: 'file-123',
      filename: 'document.pdf',
      permissions: 'download' as const,
    };

    it('should send notification via SNS and set dedup key', async () => {
      const result = await service.sendShareNotification(shareParams);

      expect(result).toBe(true);
      expect(mockSnsSend).toHaveBeenCalledOnce();
      expect(mockRedisSet).toHaveBeenCalledWith(
        'notify:file-123:user-bob:file_shared',
        '1',
        'EX',
        3600,
      );
    });

    it('should include correct SNS message attributes', async () => {
      await service.sendShareNotification(shareParams);

      const publishCommand = mockSnsSend.mock.calls[0][0];
      expect(publishCommand.input).toMatchObject({
        TopicArn: 'arn:aws:sns:us-east-1:123456789:vaultstream-notifications',
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: 'file_shared' },
          targetUserId: { DataType: 'String', StringValue: 'user-bob' },
          fileId: { DataType: 'String', StringValue: 'file-123' },
        },
      });
    });

    it('should include expiration date in message when provided', async () => {
      await service.sendShareNotification({
        ...shareParams,
        expiresAt: '2025-12-31T23:59:59.000Z',
      });

      const publishCommand = mockSnsSend.mock.calls[0][0];
      expect(publishCommand.input.Message).toContain('Expires:');
    });

    it('should include optional message in notification body', async () => {
      await service.sendShareNotification({
        ...shareParams,
        message: 'Please review this document',
      });

      const publishCommand = mockSnsSend.mock.calls[0][0];
      expect(publishCommand.input.Message).toContain('Please review this document');
    });

    it('should skip notification when dedup key exists in Redis', async () => {
      mockRedisExists.mockResolvedValueOnce(1);

      const result = await service.sendShareNotification(shareParams);

      expect(result).toBe(false);
      expect(mockSnsSend).not.toHaveBeenCalled();
    });

    it('should proceed with notification when Redis dedup check fails', async () => {
      mockRedisExists.mockRejectedValueOnce(new Error('Redis connection error'));

      const result = await service.sendShareNotification(shareParams);

      expect(result).toBe(true);
      expect(mockSnsSend).toHaveBeenCalledOnce();
    });

    it('should return false when SNS publish fails', async () => {
      mockSnsSend.mockRejectedValueOnce(new Error('SNS error'));

      const result = await service.sendShareNotification(shareParams);

      expect(result).toBe(false);
    });

    it('should still return true when Redis set fails after SNS publish', async () => {
      mockRedisSet.mockRejectedValueOnce(new Error('Redis set error'));

      const result = await service.sendShareNotification(shareParams);

      expect(result).toBe(true);
    });

    it('should work without Redis (null redis)', async () => {
      const serviceNoRedis = new NotificationService({
        snsClient: mockSnsClient,
        redis: null,
        topicArn: 'arn:aws:sns:us-east-1:123456789:vaultstream-notifications',
      });

      const result = await serviceNoRedis.sendShareNotification(shareParams);

      expect(result).toBe(true);
      expect(mockSnsSend).toHaveBeenCalledOnce();
    });
  });

  // ─── recordActivity ─────────────────────────────────────────────────────

  describe('recordActivity', () => {
    it('should store activity entity in DynamoDB', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.recordActivity({
        userId: 'user-123',
        eventType: 'file_shared',
        fileId: 'file-456',
      });

      expect(mockPutItem).toHaveBeenCalledOnce();
      expect(result.PK).toBe('USER#user-123');
      expect(result.SK).toMatch(/^ACTIVITY#/);
      expect(result.entityType).toBe('ACTIVITY');
      expect(result.eventType).toBe('file_shared');
      expect(result.fileId).toBe('file-456');
    });

    it('should include metadata when provided', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.recordActivity({
        userId: 'user-123',
        eventType: 'file_downloaded',
        metadata: { downloadedBy: 'user-456' },
      });

      expect(result.metadata).toEqual({ downloadedBy: 'user-456' });
    });

    it('should not include fileId when not provided', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.recordActivity({
        userId: 'user-123',
        eventType: 'quota_warning',
      });

      expect(result.fileId).toBeUndefined();
    });

    it('should delete oldest events when over 100 limit', async () => {
      // Create 102 mock activity events
      const events: ActivityEntity[] = Array.from({ length: 102 }, (_, i) => ({
        PK: 'USER#user-123',
        SK: `ACTIVITY#2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        entityType: 'ACTIVITY' as const,
        userId: 'user-123',
        eventType: 'file_shared' as const,
        createdAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }));

      mockQueryItems.mockResolvedValueOnce({ items: events, lastEvaluatedKey: undefined });

      await service.recordActivity({
        userId: 'user-123',
        eventType: 'file_shared',
        fileId: 'file-789',
      });

      // Should delete the 2 oldest events
      expect(mockDeleteItem).toHaveBeenCalledTimes(2);
    });

    it('should not delete events when at or below 100 limit', async () => {
      const events: ActivityEntity[] = Array.from({ length: 99 }, (_, i) => ({
        PK: 'USER#user-123',
        SK: `ACTIVITY#2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        entityType: 'ACTIVITY' as const,
        userId: 'user-123',
        eventType: 'file_shared' as const,
        createdAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }));

      mockQueryItems.mockResolvedValueOnce({ items: events, lastEvaluatedKey: undefined });

      await service.recordActivity({
        userId: 'user-123',
        eventType: 'file_shared',
      });

      expect(mockDeleteItem).not.toHaveBeenCalled();
    });
  });

  // ─── sendQuotaWarning ───────────────────────────────────────────────────

  describe('sendQuotaWarning', () => {
    const quotaParams = {
      userId: 'user-123',
      currentUsage: 4_294_967_296, // ~4 GB
      limit: 5_368_709_120, // 5 GB
    };

    it('should send quota warning via SNS and set dedup key', async () => {
      const result = await service.sendQuotaWarning(quotaParams);

      expect(result).toBe(true);
      expect(mockSnsSend).toHaveBeenCalledOnce();
      expect(mockRedisSet).toHaveBeenCalledWith(
        'notify:user-123:quota_warning',
        '1',
        'EX',
        86400,
      );
    });

    it('should include usage percentage in subject', async () => {
      await service.sendQuotaWarning(quotaParams);

      const publishCommand = mockSnsSend.mock.calls[0][0];
      expect(publishCommand.input.Subject).toContain('80%');
    });

    it('should skip when dedup key exists (already sent within 24h)', async () => {
      mockRedisExists.mockResolvedValueOnce(1);

      const result = await service.sendQuotaWarning(quotaParams);

      expect(result).toBe(false);
      expect(mockSnsSend).not.toHaveBeenCalled();
    });

    it('should return false when SNS publish fails', async () => {
      mockSnsSend.mockRejectedValueOnce(new Error('SNS error'));

      const result = await service.sendQuotaWarning(quotaParams);

      expect(result).toBe(false);
    });

    it('should include correct message attributes', async () => {
      await service.sendQuotaWarning(quotaParams);

      const publishCommand = mockSnsSend.mock.calls[0][0];
      expect(publishCommand.input.MessageAttributes).toMatchObject({
        eventType: { DataType: 'String', StringValue: 'quota_warning' },
        targetUserId: { DataType: 'String', StringValue: 'user-123' },
      });
    });
  });

  // ─── getActivityFeed ────────────────────────────────────────────────────

  describe('getActivityFeed', () => {
    it('should query DynamoDB with correct key conditions', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getActivityFeed({ userId: 'user-123' });

      expect(mockQueryItems).toHaveBeenCalledWith({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        expressionAttributeValues: {
          ':pk': 'USER#user-123',
          ':skPrefix': 'ACTIVITY#',
        },
        scanIndexForward: false,
        limit: 20,
        exclusiveStartKey: undefined,
      });
    });

    it('should use default limit of 20 when not specified', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getActivityFeed({ userId: 'user-123' });

      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('should cap limit at 100', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getActivityFeed({
        userId: 'user-123',
        pagination: { limit: 200 },
      });

      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('should decode cursor for pagination', async () => {
      const lastKey = { PK: 'USER#user-123', SK: 'ACTIVITY#2025-01-01T00:00:00.000Z' };
      const cursor = Buffer.from(JSON.stringify(lastKey)).toString('base64url');

      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.getActivityFeed({
        userId: 'user-123',
        pagination: { cursor },
      });

      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({ exclusiveStartKey: lastKey }),
      );
    });

    it('should return paginated results with nextCursor when more items exist', async () => {
      const lastKey = { PK: 'USER#user-123', SK: 'ACTIVITY#2025-01-01T00:00:00.000Z' };
      const items: ActivityEntity[] = [
        {
          PK: 'USER#user-123',
          SK: 'ACTIVITY#2025-01-15T00:00:00.000Z',
          entityType: 'ACTIVITY',
          userId: 'user-123',
          eventType: 'file_shared',
          createdAt: '2025-01-15T00:00:00.000Z',
        },
      ];

      mockQueryItems.mockResolvedValueOnce({ items, lastEvaluatedKey: lastKey });

      const result = await service.getActivityFeed({ userId: 'user-123' });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should return hasMore=false when no more items', async () => {
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      const result = await service.getActivityFeed({ userId: 'user-123' });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });
  });
});
