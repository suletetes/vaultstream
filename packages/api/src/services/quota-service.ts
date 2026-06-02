/**
 * Quota Service
 *
 * Enforces storage limits based on user subscription tier.
 * Provides atomic increment/decrement of storage usage tracking.
 */

import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../db/dynamodb';
import { userPK, userProfileSK } from '../db/key-builders';
import { TIER_QUOTAS, quotaExceededError } from '@vaultstream/shared';
import type { UserProfileEntity, Tier } from '@vaultstream/shared';

export interface QuotaCheckResult {
  allowed: boolean;
  currentUsage: number;
  limit: number;
}

/**
 * Check whether a user has sufficient quota for additional bytes.
 *
 * Fetches the user profile from DynamoDB and compares
 * currentStorageUsedBytes + additionalBytes against storageQuotaBytes.
 */
export async function checkQuota(
  userId: string,
  additionalBytes: number,
): Promise<QuotaCheckResult> {
  const pk = userPK(userId);
  const sk = userProfileSK(userId);

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: 'storageUsedBytes, storageQuotaBytes, tier',
    }),
  );

  if (!result.Item) {
    // If no profile found, default to free tier limits
    return {
      allowed: additionalBytes <= TIER_QUOTAS.free,
      currentUsage: 0,
      limit: TIER_QUOTAS.free,
    };
  }

  const profile = result.Item as Pick<UserProfileEntity, 'storageUsedBytes' | 'storageQuotaBytes' | 'tier'>;
  const currentUsage = profile.storageUsedBytes ?? 0;
  const limit = profile.storageQuotaBytes ?? TIER_QUOTAS[profile.tier as Tier] ?? TIER_QUOTAS.free;

  return {
    allowed: currentUsage + additionalBytes <= limit,
    currentUsage,
    limit,
  };
}

/**
 * Atomically increment the user's storageUsedBytes.
 *
 * Uses DynamoDB ADD expression for atomic updates.
 */
export async function incrementUsage(userId: string, bytes: number): Promise<void> {
  const pk = userPK(userId);
  const sk = userProfileSK(userId);

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'ADD storageUsedBytes :bytes',
      ExpressionAttributeValues: {
        ':bytes': bytes,
      },
    }),
  );
}

/**
 * Atomically decrement the user's storageUsedBytes.
 *
 * Uses DynamoDB ADD with a negative value for atomic decrement.
 * Includes a condition to ensure storageUsedBytes never goes below 0.
 * If the condition fails (would go negative), sets to 0 instead.
 */
export async function decrementUsage(userId: string, bytes: number): Promise<void> {
  const pk = userPK(userId);
  const sk = userProfileSK(userId);

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
        UpdateExpression: 'ADD storageUsedBytes :bytes',
        ConditionExpression: 'storageUsedBytes >= :absBytes',
        ExpressionAttributeValues: {
          ':bytes': -bytes,
          ':absBytes': bytes,
        },
      }),
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      // Would go below 0 — set to 0 instead
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: sk },
          UpdateExpression: 'SET storageUsedBytes = :zero',
          ExpressionAttributeValues: {
            ':zero': 0,
          },
        }),
      );
    } else {
      throw error;
    }
  }
}

/**
 * Convenience: check quota and throw quotaExceededError if not allowed.
 * Useful for callers that want to enforce quota with a single call.
 */
export async function enforceQuota(userId: string, additionalBytes: number): Promise<void> {
  const { allowed, currentUsage, limit } = await checkQuota(userId, additionalBytes);
  if (!allowed) {
    throw quotaExceededError(currentUsage, limit);
  }
}
