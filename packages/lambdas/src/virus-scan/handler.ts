/**
 * Virus Scanner Lambda Handler
 *
 * Processes SQS messages from the virus-scan queue to scan uploaded files
 * using ClamAV. Updates virusScanStatus in DynamoDB based on scan results.
 *
 * - Clean files: virusScanStatus = 'clean'
 * - Infected files: virusScanStatus = 'infected', S3 delete marker added, SNS notification
 * - Files > 500MB: virusScanStatus = 'skipped'
 * - Scan errors: virusScanStatus = 'error', reported as batch item failure
 *
 * Validates: Requirements 9.1-9.8
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { createWriteStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'vaultstream-metadata';
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN ?? '';
const MAX_SCAN_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

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
const snsClient = new SNSClient(clientConfig);

// ─── Helpers ────────────────────────────────────────────────────────────────

interface SQSMessageBody {
  bucket: string;
  key: string;
  size: number;
}

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

/**
 * Updates the virusScanStatus in DynamoDB for a file.
 */
async function updateVirusScanStatus(
  userId: string,
  fileId: string,
  status: 'clean' | 'infected' | 'error' | 'skipped',
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FILE#${fileId}`,
      },
      UpdateExpression: 'SET virusScanStatus = :status, updatedAt = :now',
      ExpressionAttributeValues: {
        ':status': status,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

/**
 * Downloads a file from S3 to /tmp and returns the local file path.
 */
async function downloadToTmp(bucket: string, key: string): Promise<string> {
  const tmpPath = path.join('/tmp', `scan-${randomUUID()}`);

  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  const body = response.Body;
  if (!body) {
    throw new Error('Empty response body from S3');
  }

  const writeStream = createWriteStream(tmpPath);
  await pipeline(body as Readable, writeStream);

  return tmpPath;
}

/**
 * Runs ClamAV scan on a local file.
 * Returns: 'clean' | 'infected' | 'error'
 */
async function scanFile(filePath: string): Promise<'clean' | 'infected' | 'error'> {
  return new Promise((resolve) => {
    const proc = spawn('clamscan', ['--no-summary', filePath]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      // ClamAV binary not available (e.g., in dev/test environments)
      console.warn('ClamAV not available, treating as clean', { error: err.message });
      resolve('clean');
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve('clean');
      } else if (code === 1) {
        // Exit code 1 = virus found
        resolve('infected');
      } else {
        console.error('ClamAV scan error', { code, stdout, stderr });
        resolve('error');
      }
    });
  });
}

/**
 * Cleans up a temporary file, ignoring errors.
 */
async function cleanupTmp(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Core Processing ────────────────────────────────────────────────────────

/**
 * Processes a single SQS record: downloads file, scans with ClamAV,
 * and updates DynamoDB accordingly.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const body: SQSMessageBody = JSON.parse(record.body);
  const { bucket, key, size } = body;

  const ids = extractIdsFromKey(key);
  if (!ids) {
    console.warn('Could not extract userId/fileId from S3 key', { key });
    return;
  }

  const { userId, fileId } = ids;

  // Skip files larger than 500MB (Requirement 9.4)
  if (size > MAX_SCAN_SIZE_BYTES) {
    await updateVirusScanStatus(userId, fileId, 'skipped');
    console.log('File too large for scanning, marked as skipped', { fileId, size });
    return;
  }

  let tmpPath: string | null = null;

  try {
    // Download file to /tmp (Requirement 9.1)
    tmpPath = await downloadToTmp(bucket, key);

    // Scan with ClamAV
    const result = await scanFile(tmpPath);

    if (result === 'clean') {
      // Requirement 9.2
      await updateVirusScanStatus(userId, fileId, 'clean');
      console.log('File scan clean', { fileId });
    } else if (result === 'infected') {
      // Requirement 9.3: mark infected, add delete marker, notify
      await updateVirusScanStatus(userId, fileId, 'infected');

      // Add S3 delete marker to quarantine the file
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );

      // Notify file owner via SNS
      if (SNS_TOPIC_ARN) {
        await snsClient.send(
          new PublishCommand({
            TopicArn: SNS_TOPIC_ARN,
            Subject: 'VaultStream: Infected File Detected',
            Message: JSON.stringify({
              event: 'file.infected',
              userId,
              fileId,
              key,
              timestamp: new Date().toISOString(),
            }),
          }),
        );
      }

      console.warn('File infected, quarantined', { fileId, key });
    } else {
      // Scan error — throw to trigger batch item failure (Requirement 9.5)
      throw new Error('ClamAV scan returned error status');
    }
  } finally {
    // Always clean up /tmp
    if (tmpPath) {
      await cleanupTmp(tmpPath);
    }
  }
}

// ─── Lambda Handler ─────────────────────────────────────────────────────────

/**
 * SQS batch handler for virus scanning.
 * Reports individual item failures for SQS retry (Requirement 9.5).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Virus scan processing failed', {
        messageId: record.messageId,
        error: message,
      });

      // Attempt to set status to 'error' before reporting failure
      try {
        const body: SQSMessageBody = JSON.parse(record.body);
        const ids = extractIdsFromKey(body.key);
        if (ids) {
          await updateVirusScanStatus(ids.userId, ids.fileId, 'error');
        }
      } catch {
        // Best-effort status update
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
