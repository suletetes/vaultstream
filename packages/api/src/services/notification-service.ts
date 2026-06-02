/**
 * NotificationService — Activity Feed and Notifications
 *
 * Handles:
 * - SNS notifications for share events and quota warnings
 * - Activity feed recording and retrieval in DynamoDB
 * - Deduplication via Redis keys with TTL
 *
 * Validates: Requirements 22.1-22.7, 39.1-39.6
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type Redis from 'ioredis';
import pino from 'pino';

import { userPK } from '../db/key-builders';
import { queryItems, putItem, deleteItem } from '../db/base-repository';
import { PAGINATION } from '@vaultstream/shared';
import type { Permission } from '@vaultstream/shared';

const logger = pino({ name: 'notification-service' });

// ─── Configuration ──────────────────────────────────────────────────────────

const snsClientConfig: ConstructorParameters<typeof SNSClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  snsClientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const defaultSnsClient = new SNSClient(snsClientConfig);
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN ?? '';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ACTIVITY_EVENTS = 100;
const SHARE_DEDUP_TTL_SECONDS = 3600; // 1 hour
const QUOTA_DEDUP_TTL_SECONDS = 86400; // 24 hours

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'file_shared'
  | 'file_downloaded'
  | 'share_expired'
  | 'virus_detected'
  | 'quota_warning'
  | 'version_uploaded';

export interface SendShareNotificationParams {
  sharedBy: string;
  sharedWith: string;
  fileId: string;
  filename: string;
  permissions: Permission;
  expiresAt?: string;
  message?: string;
}

export interface RecordActivityParams {
  userId: string;
  eventType: ActivityEventType;
  fileId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendQuotaWarningParams {
  userId: string;
  currentUsage: number;
  limit: number;
}

export interface GetActivityFeedParams {
  userId: string;
  pagination?: {
    cursor?: string;
    limit?: number;
  };
}

export interface ActivityEntity {
  PK: string;
  SK: string;
  entityType: 'ACTIVITY';
  userId: string;
  eventType: ActivityEventType;
  fileId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedActivityResult {
  items: ActivityEntity[];
  nextCursor?: string;
  hasMore: boolean;
}

// ─── NotificationService Class ──────────────────────────────────────────────

export class NotificationService {
  private readonly snsClient: SNSClient;
  private readonly redis: Redis | null;
  private readonly topicArn: string;

  constructor(deps?: {
    snsClient?: SNSClient;
    redis?: Redis | null;
    topicArn?: string;
  }) {
    this.snsClient = deps?.snsClient ?? defaultSnsClient;
    this.redis = deps?.redis ?? null;
    this.topicArn = deps?.topicArn ?? SNS_TOPIC_ARN;
  }

  /**
   * Send a share notification via SNS.
   *
   * Deduplication: checks Redis key `notify:{fileId}:{sharedWith}:file_shared`
   * with 1-hour TTL. If key exists, skips notification.
   *
   * Validates: Requirements 22.1, 39.1, 39.2
   */
  async sendShareNotification(params: SendShareNotificationParams): Promise<boolean> {
    const { sharedBy, sharedWith, fileId, filename, permissions, expiresAt, message } = params;

    // Deduplication check
    const dedupKey = `notify:${fileId}:${sharedWith}:file_shared`;
    if (this.redis) {
      try {
        const exists = await this.redis.exists(dedupKey);
        if (exists) {
          logger.info({ fileId, sharedWith }, 'Share notification deduplicated, skipping');
          return false;
        }
      } catch (err) {
        logger.warn({ err }, 'Redis dedup check failed, proceeding with notification');
      }
    }

    // Format notification message
    const subject = `File shared with you: ${filename}`;
    const body = this.formatShareNotificationBody({
      sharedBy,
      filename,
      permissions,
      expiresAt,
      message,
      fileId,
    });

    // Publish to SNS
    try {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Subject: subject,
          Message: body,
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: 'file_shared' },
            targetUserId: { DataType: 'String', StringValue: sharedWith },
            fileId: { DataType: 'String', StringValue: fileId },
          },
        }),
      );

      logger.info({ fileId, sharedWith, sharedBy }, 'Share notification sent');
    } catch (err) {
      logger.error({ err, fileId, sharedWith }, 'Failed to publish share notification to SNS');
      return false;
    }

    // Set dedup key in Redis
    if (this.redis) {
      try {
        await this.redis.set(dedupKey, '1', 'EX', SHARE_DEDUP_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err }, 'Failed to set dedup key in Redis');
      }
    }

    return true;
  }

  /**
   * Record an activity event in DynamoDB.
   *
   * Stores ACTIVITY entity: PK=USER#{userId}, SK=ACTIVITY#{ISO8601 timestamp}
   * Maintains max 100 events per user (deletes oldest if over).
   *
   * Validates: Requirements 22.2, 22.3, 22.5
   */
  async recordActivity(params: RecordActivityParams): Promise<ActivityEntity> {
    const { userId, eventType, fileId, metadata } = params;

    const now = new Date().toISOString();
    const activityEntity: ActivityEntity = {
      PK: userPK(userId),
      SK: `ACTIVITY#${now}`,
      entityType: 'ACTIVITY',
      userId,
      eventType,
      ...(fileId && { fileId }),
      ...(metadata && { metadata }),
      createdAt: now,
    };

    await putItem(activityEntity);

    logger.info({ userId, eventType, fileId }, 'Activity recorded');

    // Enforce max 100 events per user
    await this.enforceActivityLimit(userId);

    return activityEntity;
  }

  /**
   * Send a quota warning notification via SNS.
   *
   * Deduplication: checks Redis key `notify:{userId}:quota_warning`
   * with 24-hour TTL. Only sends once per 24 hours.
   *
   * Validates: Requirements 22.6
   */
  async sendQuotaWarning(params: SendQuotaWarningParams): Promise<boolean> {
    const { userId, currentUsage, limit } = params;

    // Deduplication check
    const dedupKey = `notify:${userId}:quota_warning`;
    if (this.redis) {
      try {
        const exists = await this.redis.exists(dedupKey);
        if (exists) {
          logger.info({ userId }, 'Quota warning deduplicated, skipping');
          return false;
        }
      } catch (err) {
        logger.warn({ err }, 'Redis dedup check failed, proceeding with notification');
      }
    }

    // Format notification
    const usagePercent = Math.round((currentUsage / limit) * 100);
    const subject = `Storage quota warning: ${usagePercent}% used`;
    const body = [
      `Your VaultStream storage is at ${usagePercent}% capacity.`,
      ``,
      `Current usage: ${this.formatBytes(currentUsage)}`,
      `Storage limit: ${this.formatBytes(limit)}`,
      ``,
      `Consider upgrading your plan or removing unused files to free up space.`,
    ].join('\n');

    // Publish to SNS
    try {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Subject: subject,
          Message: body,
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: 'quota_warning' },
            targetUserId: { DataType: 'String', StringValue: userId },
          },
        }),
      );

      logger.info({ userId, usagePercent }, 'Quota warning notification sent');
    } catch (err) {
      logger.error({ err, userId }, 'Failed to publish quota warning to SNS');
      return false;
    }

    // Set dedup key in Redis
    if (this.redis) {
      try {
        await this.redis.set(dedupKey, '1', 'EX', QUOTA_DEDUP_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err }, 'Failed to set quota dedup key in Redis');
      }
    }

    return true;
  }

  /**
   * Get the activity feed for a user.
   *
   * Queries DynamoDB: PK=USER#{userId}, SK begins_with ACTIVITY#, sorted desc.
   * Paginated with default 20, max 100.
   *
   * Validates: Requirements 22.3, 22.4
   */
  async getActivityFeed(params: GetActivityFeedParams): Promise<PaginatedActivityResult> {
    const { userId, pagination } = params;

    const limit = Math.min(
      pagination?.limit ?? PAGINATION.defaultLimit,
      PAGINATION.maxLimit,
    );

    const exclusiveStartKey = pagination?.cursor
      ? JSON.parse(Buffer.from(pagination.cursor, 'base64url').toString('utf-8'))
      : undefined;

    const result = await queryItems<ActivityEntity>({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': userPK(userId),
        ':skPrefix': 'ACTIVITY#',
      },
      scanIndexForward: false,
      limit,
      exclusiveStartKey,
    });

    // Build next cursor
    let nextCursor: string | undefined;
    if (result.lastEvaluatedKey) {
      nextCursor = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url');
    }

    return {
      items: result.items,
      nextCursor,
      hasMore: !!result.lastEvaluatedKey,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Enforce the maximum activity events limit (100) per user.
   * Queries all activity events and deletes the oldest if over the limit.
   */
  private async enforceActivityLimit(userId: string): Promise<void> {
    try {
      // Query all activity events for the user (sorted ascending by SK)
      const result = await queryItems<ActivityEntity>({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        expressionAttributeValues: {
          ':pk': userPK(userId),
          ':skPrefix': 'ACTIVITY#',
        },
        scanIndexForward: true,
      });

      if (result.items.length > MAX_ACTIVITY_EVENTS) {
        // Delete the oldest events (those beyond the limit)
        const eventsToDelete = result.items.slice(0, result.items.length - MAX_ACTIVITY_EVENTS);

        for (const event of eventsToDelete) {
          await deleteItem(event.PK, event.SK);
        }

        logger.info(
          { userId, deleted: eventsToDelete.length },
          'Pruned old activity events',
        );
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to enforce activity limit');
    }
  }

  /**
   * Format the share notification email body.
   */
  private formatShareNotificationBody(params: {
    sharedBy: string;
    filename: string;
    permissions: Permission;
    expiresAt?: string;
    message?: string;
    fileId: string;
  }): string {
    const { sharedBy, filename, permissions, expiresAt, message, fileId } = params;

    const lines: string[] = [
      `${sharedBy} has shared a file with you on VaultStream.`,
      ``,
      `File: ${filename}`,
      `Permission: ${permissions}`,
    ];

    if (expiresAt) {
      lines.push(`Expires: ${new Date(expiresAt).toLocaleDateString()}`);
    }

    if (message) {
      lines.push(``, `Message from ${sharedBy}:`, `"${message}"`);
    }

    lines.push(
      ``,
      `Access the file here: https://app.vaultstream.dev/shared/${fileId}`,
    );

    return lines.join('\n');
  }

  /**
   * Format bytes into a human-readable string.
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }
}

// ─── Default singleton instance ─────────────────────────────────────────────

export const notificationService = new NotificationService();
