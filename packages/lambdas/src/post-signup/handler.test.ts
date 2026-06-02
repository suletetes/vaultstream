/**
 * Unit tests for Post-Signup Lambda Handler
 *
 * Validates: Requirement 12.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  PutCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { handler } from './handler';

function createEvent(overrides: Partial<{
  sub: string;
  email: string;
  name: string;
}>): PostConfirmationTriggerEvent {
  const { sub = 'user-123-abc', email = 'alice@example.com', name } = overrides;

  const userAttributes: Record<string, string> = { sub, email };
  if (name !== undefined) {
    userAttributes.name = name;
  }

  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_TestPool',
    userName: 'alice',
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    request: {
      userAttributes,
    },
    response: {},
  } as PostConfirmationTriggerEvent;
}

describe('Post-Signup Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should create a USER_PROFILE entity in DynamoDB with correct attributes', async () => {
    const event = createEvent({ sub: 'user-abc-123', email: 'bob@example.com', name: 'Bob Smith' });

    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'vaultstream-metadata',
        Item: expect.objectContaining({
          PK: 'USER#user-abc-123',
          SK: 'PROFILE#user-abc-123',
          entityType: 'USER_PROFILE',
          email: 'bob@example.com',
          displayName: 'Bob Smith',
          storageUsedBytes: 0,
          storageQuotaBytes: 5_368_709_120,
          tier: 'free',
          role: 'user',
          GSI1PK: 'USERS',
        }),
      }),
    );
  });

  it('should use email prefix as displayName when name attribute is missing', async () => {
    const event = createEvent({ sub: 'user-456', email: 'charlie@company.io' });

    await handler(event);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          displayName: 'charlie',
        }),
      }),
    );
  });

  it('should use email prefix as displayName when name attribute is empty string', async () => {
    const event = createEvent({ sub: 'user-789', email: 'dave@test.org', name: '   ' });

    await handler(event);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          displayName: 'dave',
        }),
      }),
    );
  });

  it('should set createdAt and updatedAt to the same ISO8601 timestamp', async () => {
    const event = createEvent({ sub: 'user-time' });

    await handler(event);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const call = vi.mocked(PutCommand).mock.calls[0][0];
    const item = call.Item as Record<string, unknown>;

    expect(item.createdAt).toBe(item.updatedAt);
    // Verify it's a valid ISO8601 string
    expect(new Date(item.createdAt as string).toISOString()).toBe(item.createdAt);
  });

  it('should set GSI1SK to the same value as createdAt', async () => {
    const event = createEvent({ sub: 'user-gsi' });

    await handler(event);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const call = vi.mocked(PutCommand).mock.calls[0][0];
    const item = call.Item as Record<string, unknown>;

    expect(item.GSI1SK).toBe(item.createdAt);
  });

  it('should include a ConditionExpression to prevent overwriting existing profiles', async () => {
    const event = createEvent({ sub: 'user-cond' });

    await handler(event);

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  });

  it('should always return the event object even when DynamoDB write fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB service unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = createEvent({ sub: 'user-fail', email: 'fail@test.com' });
    const result = await handler(event);

    expect(result).toBe(event);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to create user profile',
      expect.objectContaining({
        userId: 'user-fail',
        email: 'fail@test.com',
        error: 'DynamoDB service unavailable',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('should log success when profile is created', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const event = createEvent({ sub: 'user-log', email: 'log@test.com', name: 'Logger' });
    await handler(event);

    expect(consoleSpy).toHaveBeenCalledWith(
      'User profile created',
      expect.objectContaining({
        userId: 'user-log',
        email: 'log@test.com',
        displayName: 'Logger',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('should handle ConditionalCheckFailedException gracefully (duplicate signup)', async () => {
    const condError = new Error('The conditional request failed');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValue(condError);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = createEvent({ sub: 'user-dup', email: 'dup@test.com' });
    const result = await handler(event);

    // Should still return event without throwing
    expect(result).toBe(event);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
