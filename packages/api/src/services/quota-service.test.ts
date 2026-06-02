import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkQuota, incrementUsage, decrementUsage, enforceQuota } from './quota-service';
import { TIER_QUOTAS, AppError, ErrorCode } from '@vaultstream/shared';

// Mock the DynamoDB document client
const mockSend = vi.fn();
vi.mock('../db/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'vaultstream-metadata',
}));

describe('quota-service', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('checkQuota', () => {
    it('should return allowed=true when usage + additional is within quota', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: 1_000_000,
          storageQuotaBytes: TIER_QUOTAS.free,
          tier: 'free',
        },
      });

      const result = await checkQuota('user-123', 500_000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 1_000_000,
        limit: TIER_QUOTAS.free,
      });
    });

    it('should return allowed=false when usage + additional exceeds quota', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: TIER_QUOTAS.free - 100,
          storageQuotaBytes: TIER_QUOTAS.free,
          tier: 'free',
        },
      });

      const result = await checkQuota('user-123', 200);

      expect(result).toEqual({
        allowed: false,
        currentUsage: TIER_QUOTAS.free - 100,
        limit: TIER_QUOTAS.free,
      });
    });

    it('should return allowed=true when usage + additional equals exactly the quota', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: TIER_QUOTAS.pro - 1000,
          storageQuotaBytes: TIER_QUOTAS.pro,
          tier: 'pro',
        },
      });

      const result = await checkQuota('user-456', 1000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: TIER_QUOTAS.pro - 1000,
        limit: TIER_QUOTAS.pro,
      });
    });

    it('should default to free tier when user profile is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await checkQuota('unknown-user', 100);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 0,
        limit: TIER_QUOTAS.free,
      });
    });

    it('should default to free tier when user profile not found and bytes exceed free limit', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await checkQuota('unknown-user', TIER_QUOTAS.free + 1);

      expect(result).toEqual({
        allowed: false,
        currentUsage: 0,
        limit: TIER_QUOTAS.free,
      });
    });

    it('should use storageQuotaBytes from profile over tier default', async () => {
      // Custom quota set on the profile (e.g., admin override)
      const customQuota = 50_000_000_000;
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: 10_000_000_000,
          storageQuotaBytes: customQuota,
          tier: 'free',
        },
      });

      const result = await checkQuota('user-789', 1_000_000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 10_000_000_000,
        limit: customQuota,
      });
    });

    it('should use correct DynamoDB key pattern', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: 0,
          storageQuotaBytes: TIER_QUOTAS.free,
          tier: 'free',
        },
      });

      await checkQuota('user-abc', 100);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key).toEqual({
        PK: 'USER#user-abc',
        SK: 'PROFILE#user-abc',
      });
      expect(command.input.TableName).toBe('vaultstream-metadata');
    });

    it('should handle enterprise tier quota correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: 500_000_000_000,
          storageQuotaBytes: TIER_QUOTAS.enterprise,
          tier: 'enterprise',
        },
      });

      const result = await checkQuota('enterprise-user', 100_000_000_000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 500_000_000_000,
        limit: TIER_QUOTAS.enterprise,
      });
    });
  });

  describe('incrementUsage', () => {
    it('should send UpdateCommand with ADD expression', async () => {
      mockSend.mockResolvedValueOnce({});

      await incrementUsage('user-123', 5_000_000);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('vaultstream-metadata');
      expect(command.input.Key).toEqual({
        PK: 'USER#user-123',
        SK: 'PROFILE#user-123',
      });
      expect(command.input.UpdateExpression).toBe('ADD storageUsedBytes :bytes');
      expect(command.input.ExpressionAttributeValues[':bytes']).toBe(5_000_000);
    });

    it('should use positive value for increment', async () => {
      mockSend.mockResolvedValueOnce({});

      await incrementUsage('user-456', 1024);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':bytes']).toBe(1024);
    });
  });

  describe('decrementUsage', () => {
    it('should send UpdateCommand with ADD negative value and condition', async () => {
      mockSend.mockResolvedValueOnce({});

      await decrementUsage('user-123', 3_000_000);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('vaultstream-metadata');
      expect(command.input.Key).toEqual({
        PK: 'USER#user-123',
        SK: 'PROFILE#user-123',
      });
      expect(command.input.UpdateExpression).toBe('ADD storageUsedBytes :bytes');
      expect(command.input.ConditionExpression).toBe('storageUsedBytes >= :absBytes');
      expect(command.input.ExpressionAttributeValues[':bytes']).toBe(-3_000_000);
      expect(command.input.ExpressionAttributeValues[':absBytes']).toBe(3_000_000);
    });

    it('should set storageUsedBytes to 0 when ConditionalCheckFailedException occurs', async () => {
      const conditionError = new Error('The conditional request failed');
      conditionError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionError);
      mockSend.mockResolvedValueOnce({});

      await decrementUsage('user-123', 999_999_999);

      // Second call should set to 0
      expect(mockSend).toHaveBeenCalledTimes(2);
      const fallbackCommand = mockSend.mock.calls[1][0];
      expect(fallbackCommand.input.UpdateExpression).toBe('SET storageUsedBytes = :zero');
      expect(fallbackCommand.input.ExpressionAttributeValues[':zero']).toBe(0);
    });

    it('should rethrow non-conditional-check errors', async () => {
      const genericError = new Error('Service unavailable');
      genericError.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValueOnce(genericError);

      await expect(decrementUsage('user-123', 1000)).rejects.toThrow('Service unavailable');
    });
  });

  describe('enforceQuota', () => {
    it('should not throw when quota is sufficient', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: 1_000_000,
          storageQuotaBytes: TIER_QUOTAS.pro,
          tier: 'pro',
        },
      });

      await expect(enforceQuota('user-123', 500_000)).resolves.toBeUndefined();
    });

    it('should throw quotaExceededError when quota is exceeded', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          storageUsedBytes: TIER_QUOTAS.free - 50,
          storageQuotaBytes: TIER_QUOTAS.free,
          tier: 'free',
        },
      });

      await expect(enforceQuota('user-123', 100)).rejects.toThrow(AppError);

      try {
        mockSend.mockResolvedValueOnce({
          Item: {
            storageUsedBytes: TIER_QUOTAS.free - 50,
            storageQuotaBytes: TIER_QUOTAS.free,
            tier: 'free',
          },
        });
        await enforceQuota('user-123', 100);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe(ErrorCode.QUOTA_EXCEEDED);
        expect((error as AppError).statusCode).toBe(409);
      }
    });
  });
});
