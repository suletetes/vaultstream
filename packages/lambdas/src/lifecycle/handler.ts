/**
 * Lifecycle Processor Lambda Handler
 *
 * Processes SQS messages containing S3 storage class transition events.
 * Updates the storageClass attribute in DynamoDB to reflect the new tier.
 * Also handles permanent purge of soft-deleted files after 30 days.
 *
 * Validates: Requirements 10.4, 10.5, 6.6, 27.5
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'vaultstream-metadata';
const FILES_BUCKET = process.env.FILES_BUCKET_NAME ?? 'vaultstream-files';

// ─── AWS Clients ────────────────────────────────────────────────────────────

const clientConfig: { region: string; endpoint?: string } = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  clientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const s3Client = new S3Client(clientConfig);
const ddbClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

// ─── Types ──────────────────────────────────────────────────────────────────

type StorageClass = 'STANDARD' | 'STANDARD_IA' | 'GLACIER_IR' | 'DEEP_ARCHIVE';

interface StorageClassTransitionEvent {
  eventType: 'storage-class-transition';
  bucket: string;
  key: string;
  storageClass: StorageClass;
}

interface SoftDeletePurgeEvent {
  eventType: 'soft-delete-purge';
  userId: string;
  fileId: string;
}

type LifecycleEvent = StorageClassTransitionEvent | SoftDeletePurgeEvent;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts userId and fileId from the S3 key pattern:
 * users/{userId}/files/{fileId}/...
 */
function extractIdsFromKey(key: string): { userId: string; fileId: string } | null {
  const parts = key.split('/');
  const usersIdx = parts.indexOf('users');
  if (usersIdx === -1 || usersIdx + 3 >= parts.length) {
    return null;
  }
  const userId = parts[usersIdx + 1];
  const fileId = parts[usersIdx + 3];
  if (!userId || !fileId) {
    return null;
  }
  return { userId, fileId };
}

// ─── Storage Class Transition ───────────────────────────────────────────────

/**
 * Updates the storageClass attribute in DynamoDB for a file (Requirement 10.4).
 */
async function handleStorageClassTransition(
  event: StorageClassTransitionEvent,
): Promise<void> {
  const ids = extractIdsFromKey(event.key);
  if (!ids) {
    console.warn('Could not extract userId/fileId from S3 key', { key: event.key });
    return;
  }

  const { userId, fileId } = ids;

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FILE#${fileId}`,
      },
      UpdateExpression: 'SET storageClass = :sc, updatedAt = :now',
      ExpressionAttributeValues: {
        ':sc': event.storageClass,
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );

  console.log('Storage class updated', { fileId, storageClass: event.storageClass });
}

// ─── Soft-Delete Permanent Purge ────────────────────────────────────────────

/**
 * Permanently deletes a soft-deleted file after 30 days (Requirement 6.6).
 * Removes: DynamoDB FILE item, all VERSION records, all SHARE records,
 * and all S3 object versions.
 */
async function handleSoftDeletePurge(event: SoftDeletePurgeEvent): Promise<void> {
  const { userId, fileId } = event;

  // 1. Query all VERSION records for this file
  const versionsResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `FILE#${fileId}`,
        ':skPrefix': 'VERSION#',
      },
    }),
  );

  // 2. Query all SHARE records for this file
  const sharesResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `FILE#${fileId}`,
        ':skPrefix': 'SHARE#',
      },
    }),
  );

  // 3. Delete the FILE item from DynamoDB
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FILE#${fileId}`,
      },
    }),
  );

  // 4. Batch delete VERSION and SHARE records
  const itemsToDelete = [
    ...(versionsResult.Items ?? []),
    ...(sharesResult.Items ?? []),
  ];

  // DynamoDB BatchWrite supports max 25 items per request
  for (let i = 0; i < itemsToDelete.length; i += 25) {
    const batch = itemsToDelete.slice(i, i + 25);
    const deleteRequests = batch.map((item) => ({
      DeleteRequest: {
        Key: {
          PK: item.PK as string,
          SK: item.SK as string,
        },
      },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: deleteRequests,
        },
      }),
    );
  }

  // 5. Delete all S3 object versions
  const s3KeyPrefix = `users/${userId}/files/${fileId}/`;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const listResult = await s3Client.send(
      new ListObjectVersionsCommand({
        Bucket: FILES_BUCKET,
        Prefix: s3KeyPrefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );

    const versions = listResult.Versions ?? [];
    const deleteMarkers = listResult.DeleteMarkers ?? [];
    const allObjects = [...versions, ...deleteMarkers];

    for (const obj of allObjects) {
      if (obj.Key && obj.VersionId) {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: FILES_BUCKET,
            Key: obj.Key,
            VersionId: obj.VersionId,
          }),
        );
      }
    }

    keyMarker = listResult.NextKeyMarker;
    versionIdMarker = listResult.NextVersionIdMarker;
  } while (keyMarker);

  console.log('Permanent purge completed', { userId, fileId });
}

// ─── Core Processing ────────────────────────────────────────────────────────

/**
 * Parses the SQS message body and determines the event type.
 */
function parseEvent(body: string): LifecycleEvent {
  const parsed = JSON.parse(body);

  // Check if this is a soft-delete purge event
  if (parsed.eventType === 'soft-delete-purge') {
    return parsed as SoftDeletePurgeEvent;
  }

  // Default: storage class transition event
  return {
    eventType: 'storage-class-transition',
    bucket: parsed.bucket ?? parsed.detail?.bucket?.name ?? '',
    key: parsed.key ?? parsed.detail?.object?.key ?? '',
    storageClass: parsed.storageClass ?? parsed.detail?.object?.['storage-class'] ?? 'STANDARD',
  } as StorageClassTransitionEvent;
}

/**
 * Processes a single SQS record.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const event = parseEvent(record.body);

  switch (event.eventType) {
    case 'storage-class-transition':
      await handleStorageClassTransition(event);
      break;
    case 'soft-delete-purge':
      await handleSoftDeletePurge(event);
      break;
    default:
      console.warn('Unknown lifecycle event type', { event });
  }
}

// ─── Lambda Handler ─────────────────────────────────────────────────────────

/**
 * SQS batch handler for lifecycle processing.
 * Reports individual item failures for SQS retry (Requirement 10.5).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Lifecycle processing failed', {
        messageId: record.messageId,
        error: message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
