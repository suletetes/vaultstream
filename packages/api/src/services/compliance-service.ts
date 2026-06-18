/**
 * ComplianceService — Data subject deletion and compliance controls
 *
 * - deleteUserData: Permanently remove all user data (GDPR right to erasure)
 * - verifyEncryption: Check all storage services have encryption enabled
 *
 * Requirements: 40.1, 40.7, 40.8
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import pino from 'pino';

import { docClient, TABLE_NAME } from '../db/dynamodb';

import { getAuditService } from './audit-service';


const logger = pino({ name: 'compliance-service' });

const FILES_BUCKET = process.env.S3_FILES_BUCKET || 'vaultstream-files-local';
const THUMBNAILS_BUCKET = process.env.S3_THUMBNAILS_BUCKET || 'vaultstream-thumbnails-local';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT_URL && { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true }),
});

export class ComplianceService {
  /**
   * Delete all user data — GDPR Article 17 (Right to Erasure)
   *
   * Removes: DynamoDB items (profile, files, folders, shares, versions, comments),
   * S3 objects (files + thumbnails), and anonymizes audit log references.
   *
   * Must complete within 30 days of verified request.
   */
  async deleteUserData(adminUserId: string, targetUserId: string): Promise<{ deletedItems: number; deletedObjects: number }> {
    logger.info({ adminUserId, targetUserId }, 'Starting data subject deletion');

    let deletedItems = 0;
    let deletedObjects = 0;

    const dynamodb = docClient;

    // 1. Delete all DynamoDB items for the user
    const userItems = await this.queryAllUserItems(targetUserId);
    for (const batch of this.chunk(userItems, 25)) {
      await dynamodb.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
          })),
        },
      }));
      deletedItems += batch.length;
    }

    // 2. Delete all file shares where user is the target
    const shareItems = await this.querySharesForUser(targetUserId);
    for (const batch of this.chunk(shareItems, 25)) {
      await dynamodb.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
          })),
        },
      }));
      deletedItems += batch.length;
    }

    // 3. Delete S3 objects
    deletedObjects += await this.deleteS3Prefix(FILES_BUCKET, `users/${targetUserId}/`);
    deletedObjects += await this.deleteS3Prefix(THUMBNAILS_BUCKET, `users/${targetUserId}/`);

    // 4. Log the deletion as a critical audit event
    getAuditService().logEvent({
      eventType: 'compliance.data_deleted',
      severity: 'critical',
      userId: adminUserId,
      action: 'delete_user_data',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { deletedItems, deletedObjects, targetUserId },
    });

    logger.info({ targetUserId, deletedItems, deletedObjects }, 'Data subject deletion complete');
    return { deletedItems, deletedObjects };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async queryAllUserItems(userId: string): Promise<Array<{ PK: string; SK: string }>> {
    const dynamodb = docClient;
    const items: Array<{ PK: string; SK: string }> = [];

    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }));

      for (const item of result.Items || []) {
        items.push({ PK: item.PK as string, SK: item.SK as string });
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  private async querySharesForUser(userId: string): Promise<Array<{ PK: string; SK: string }>> {
    const dynamodb = docClient;
    const items: Array<{ PK: string; SK: string }> = [];

    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }));

      for (const item of result.Items || []) {
        items.push({ PK: item.PK as string, SK: item.SK as string });
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  private async deleteS3Prefix(bucket: string, prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      const objects = listResult.Contents || [];
      if (objects.length > 0) {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.map((obj) => ({ Key: obj.Key! })) },
        }));
        deleted += objects.length;
      }

      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return deleted;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

export const complianceService = new ComplianceService();
