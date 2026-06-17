/**
 * ShareService — File Sharing Management
 *
 * Handles share creation, revocation, permission updates, and shared-with-me queries.
 * Integrates with:
 * - DynamoDB for share entity persistence
 * - Redis cache for shared-with-me view caching
 * - EventBridge for FileShared event publishing
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import pino from 'pino';

import { docClient, TABLE_NAME } from '../db/dynamodb';
import { sharePK, shareSK, gsi3Keys } from '../db/key-builders';
import { queryItems, putItem, deleteItem, updateItem, getItem } from '../db/base-repository';
import {
  validationError,
  MAX_SHARES_PER_FILE,
  AppError,
  ErrorCode,
} from '@vaultstream/shared';
import type { ShareEntity, Permission, PaginationParams } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = pino({ name: 'share-service' });

// ─── Configuration ──────────────────────────────────────────────────────────

const eventBridgeClientConfig: ConstructorParameters<typeof EventBridgeClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  eventBridgeClientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const defaultEventBridgeClient = new EventBridgeClient(eventBridgeClientConfig);
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CreateShareParams {
  ownerId: string;
  fileId: string;
  targetEmail: string;
  permissions: Permission;
  expiresInHours?: number;
  message?: string;
}

export interface RevokeShareParams {
  ownerId: string;
  fileId: string;
  targetUserId: string;
}

export interface UpdatePermissionsParams {
  ownerId: string;
  fileId: string;
  targetUserId: string;
  permissions: Permission;
}

export interface GetSharedWithMeParams {
  userId: string;
  pagination?: PaginationParams;
}

export interface ListSharesForFileParams {
  fileId: string;
  ownerId: string;
}

export interface PaginatedShareResult {
  items: ShareEntity[];
  nextCursor?: string;
  hasMore: boolean;
}

// ─── ShareService Class ─────────────────────────────────────────────────────

export class ShareService {
  private readonly eventBridge: EventBridgeClient;
  private readonly cacheService: CacheService | null;

  constructor(deps?: {
    eventBridgeClient?: EventBridgeClient;
    cacheService?: CacheService | null;
  }) {
    this.eventBridge = deps?.eventBridgeClient ?? defaultEventBridgeClient;
    this.cacheService = deps?.cacheService ?? null;
  }

  /**
   * Create a share for a file with a target user resolved by email.
   *
   * Flow:
   * 1. Resolve targetEmail to userId via DynamoDB GSI1 (USERS partition)
   * 2. Prevent self-sharing
   * 3. Check share count limit (MAX_SHARES_PER_FILE = 50)
   * 4. Calculate expiresAt if expiresInHours provided
   * 5. Create SHARE entity in DynamoDB
   * 6. Invalidate target user's shared cache
   * 7. Publish FileShared event to EventBridge
   * 8. Return the share record
   */
  async createShare(params: CreateShareParams): Promise<ShareEntity> {
    const { ownerId, fileId, targetEmail, permissions, expiresInHours, message } = params;

    // 1. Resolve targetEmail to userId
    const targetUserId = await this.resolveEmailToUserId(targetEmail);
    if (!targetUserId) {
      throw validationError('Target user was not found');
    }

    // 2. Prevent self-sharing
    if (targetUserId === ownerId) {
      throw validationError('Cannot share a file with yourself');
    }

    // 3. Check share count limit
    const existingShares = await queryItems<ShareEntity>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': sharePK(fileId),
        ':skPrefix': 'SHARE#',
      },
    });

    if (existingShares.items.length >= MAX_SHARES_PER_FILE) {
      throw validationError('Maximum shares per file exceeded');
    }

    // 4. Calculate expiresAt
    let expiresAt: number | undefined;
    if (expiresInHours !== undefined) {
      expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    }

    // 5. Create SHARE entity
    const now = new Date().toISOString();
    const shareEntity: ShareEntity = {
      PK: sharePK(fileId),
      SK: shareSK(targetUserId),
      entityType: 'SHARE',
      fileId,
      sharedBy: ownerId,
      sharedWith: targetUserId,
      permissions,
      sharedAt: now,
      ...(expiresAt !== undefined && { expiresAt }),
      ...gsi3Keys(targetUserId, now),
    };

    await putItem(shareEntity);

    logger.info({ fileId, ownerId, targetUserId, permissions }, 'Share created');

    // 6. Invalidate target user's shared cache
    await this.invalidateSharedCache(targetUserId);

    // 7. Publish FileShared event to EventBridge
    try {
      await this.eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'vaultstream.api',
              DetailType: 'FileShared',
              Detail: JSON.stringify({
                fileId,
                sharedBy: ownerId,
                sharedWith: targetUserId,
                permissions,
                ...(message && { message }),
              }),
              EventBusName: EVENT_BUS_NAME,
            },
          ],
        }),
      );
    } catch (err) {
      // Log but don't block share creation — event publishing is best-effort
      logger.warn({ err, fileId, targetUserId }, 'Failed to publish FileShared event');
    }

    // 8. Return the share record
    return shareEntity;
  }

  /**
   * Revoke a share by deleting the SHARE entity.
   */
  async revokeShare(params: RevokeShareParams): Promise<void> {
    const { fileId, targetUserId } = params;

    await deleteItem(sharePK(fileId), shareSK(targetUserId));

    logger.info({ fileId, targetUserId }, 'Share revoked');

    // Invalidate target user's shared cache
    await this.invalidateSharedCache(targetUserId);
  }

  /**
   * Update permissions on an existing share.
   * Only updates the permissions attribute — does not change sharedAt or expiresAt.
   */
  async updatePermissions(params: UpdatePermissionsParams): Promise<void> {
    const { fileId, targetUserId, permissions } = params;

    await updateItem(sharePK(fileId), shareSK(targetUserId), { permissions });

    logger.info({ fileId, targetUserId, permissions }, 'Share permissions updated');

    // Invalidate target user's shared cache
    await this.invalidateSharedCache(targetUserId);
  }

  /**
   * Get files shared with a user (shared-with-me view).
   *
   * Flow:
   * 1. Check Redis cache
   * 2. On miss: query GSI3 (sorted by sharedAt desc)
   * 3. Filter out expired shares
   * 4. Populate cache on miss
   * 5. Return paginated results
   */
  async getSharedWithMe(params: GetSharedWithMeParams): Promise<PaginatedShareResult> {
    const { userId, pagination } = params;
    const limit = pagination?.limit ?? 20;

    // 1. Check Redis cache (only on first page with no cursor)
    if (!pagination?.cursor && this.cacheService) {
      const cached = await this.cacheService.getSharedWithMe(userId);
      if (cached) {
        // Filter out expired shares from cache
        const nowEpoch = Math.floor(Date.now() / 1000);
        const validShares = cached.filter(
          (share) => !share.expiresAt || share.expiresAt > nowEpoch,
        );
        return {
          items: validShares.slice(0, limit),
          hasMore: validShares.length > limit,
          ...(validShares.length > limit && { nextCursor: validShares[limit - 1]?.sharedAt }),
        };
      }
    }

    // 2. Query GSI3 for shares targeting this user
    const exclusiveStartKey = pagination?.cursor
      ? JSON.parse(Buffer.from(pagination.cursor, 'base64url').toString('utf-8'))
      : undefined;

    const result = await queryItems<ShareEntity>({
      indexName: 'GSI3',
      keyConditionExpression: 'GSI3PK = :gsi3pk',
      expressionAttributeValues: {
        ':gsi3pk': `USER#${userId}`,
      },
      scanIndexForward: false,
      limit,
      exclusiveStartKey,
    });

    // 3. Filter out expired shares
    const nowEpoch = Math.floor(Date.now() / 1000);
    const validShares = result.items.filter(
      (share) => !share.expiresAt || share.expiresAt > nowEpoch,
    );

    // 4. Populate cache on miss (only for first page)
    if (!pagination?.cursor && this.cacheService && validShares.length > 0) {
      try {
        await this.cacheService.setSharedWithMe(userId, validShares);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to populate shared-with-me cache');
      }
    }

    // 5. Build next cursor
    let nextCursor: string | undefined;
    if (result.lastEvaluatedKey) {
      nextCursor = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url');
    }

    return {
      items: validShares,
      nextCursor,
      hasMore: !!result.lastEvaluatedKey,
    };
  }

  /**
   * List all shares for a specific file.
   * Verifies the requesting user is the file owner before returning shares.
   */
  async listSharesForFile(params: ListSharesForFileParams): Promise<ShareEntity[]> {
    const { fileId, ownerId } = params;

    // Verify ownership before returning shares
    const file = await getItem<{ PK: string }>(
      `USER#${ownerId}` as `USER#${string}`,
      `FILE#${fileId}` as `FILE#${string}`,
    );

    if (!file) {
      throw new AppError({
        code: ErrorCode.FORBIDDEN,
        message: 'Access denied',
      });
    }

    const result = await queryItems<ShareEntity>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': sharePK(fileId),
        ':skPrefix': 'SHARE#',
      },
    });

    return result.items;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Resolve an email address to a userId by querying the GSI1 (USERS partition).
   * Returns null if no user is found with the given email.
   */
  private async resolveEmailToUserId(email: string): Promise<string | null> {
    // Query GSI1 where GSI1PK = 'USERS' and filter by email
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        FilterExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':gsi1pk': 'USERS',
          ':email': email,
        },
        Limit: 1,
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // Extract userId from PK (format: USER#{userId})
    const pk = result.Items[0].PK as string;
    return pk.replace('USER#', '');
  }

  /**
   * Invalidate the target user's shared-with-me cache.
   */
  private async invalidateSharedCache(userId: string): Promise<void> {
    if (!this.cacheService) return;

    try {
      await this.cacheService.invalidateUserCache(userId);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to invalidate shared cache');
    }
  }
}

// ─── Default singleton instance ─────────────────────────────────────────────

export const shareService = new ShareService();
