/**
 * Thumbnail Lambda Handler
 *
 * Processes SQS messages from the thumbnail queue to generate WebP thumbnails
 * for uploaded image files. Generates two sizes:
 * - "thumb": 200x200 (fit: inside, withoutEnlargement)
 * - "preview": 800x600 (fit: inside, withoutEnlargement)
 *
 * Validates: Requirements 8.1-8.7
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import sharp from 'sharp';

// ─── Configuration ──────────────────────────────────────────────────────────

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'vaultstream-metadata';
const THUMBNAILS_BUCKET = process.env.THUMBNAILS_BUCKET_NAME ?? 'vaultstream-thumbnails';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

interface ThumbnailSize {
  suffix: string;
  width: number;
  height: number;
}

const THUMBNAIL_SIZES: ThumbnailSize[] = [
  { suffix: 'thumb', width: 200, height: 200 },
  { suffix: 'preview', width: 800, height: 600 },
];

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

// ─── Helpers ────────────────────────────────────────────────────────────────

interface SQSMessageBody {
  bucket: string;
  key: string;
  size: number;
}

/**
 * Extracts the file extension from an S3 key.
 */
function getExtension(key: string): string {
  const parts = key.split('.');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/**
 * Checks if the file extension corresponds to a supported image format.
 */
function isSupportedImage(key: string): boolean {
  const ext = getExtension(key);
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

/**
 * Extracts userId and fileId from the S3 key pattern:
 * users/{userId}/files/{fileId}/...
 */
function extractIdsFromKey(key: string): { userId: string; fileId: string } | null {
  const parts = key.split('/');
  // Expected: users/{userId}/files/{fileId}/...
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
 * Builds the thumbnail S3 key for a given userId, fileId, and suffix.
 */
function buildThumbnailKey(userId: string, fileId: string, suffix: string): string {
  return `users/${userId}/files/${fileId}/${suffix}.webp`;
}

// ─── Core Processing ────────────────────────────────────────────────────────

/**
 * Processes a single SQS record: downloads the image, generates thumbnails,
 * uploads them, and updates DynamoDB.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const body: SQSMessageBody = JSON.parse(record.body);
  const { bucket, key } = body;

  // Skip non-image files silently (Requirement 8.7)
  if (!isSupportedImage(key)) {
    return;
  }

  const ids = extractIdsFromKey(key);
  if (!ids) {
    console.warn('Could not extract userId/fileId from S3 key', { key });
    return;
  }

  const { userId, fileId } = ids;

  // Download the original image from S3
  const getResponse = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  const imageBuffer = await streamToBuffer(getResponse.Body);

  // Generate and upload thumbnails
  const thumbKey = buildThumbnailKey(userId, fileId, 'thumb');

  for (const size of THUMBNAIL_SIZES) {
    const resizedBuffer = await sharp(imageBuffer)
      .resize(size.width, size.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer();

    const thumbnailKey = buildThumbnailKey(userId, fileId, size.suffix);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: THUMBNAILS_BUCKET,
        Key: thumbnailKey,
        Body: resizedBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000',
      }),
    );
  }

  // Update DynamoDB with the thumbnail key (Requirement 8.4)
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FILE#${fileId}`,
      },
      UpdateExpression: 'SET thumbnailKey = :thumbKey, updatedAt = :now',
      ExpressionAttributeValues: {
        ':thumbKey': thumbKey,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

/**
 * Converts a readable stream (S3 Body) to a Buffer.
 */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  if (stream instanceof Buffer) {
    return stream;
  }

  // Handle Node.js Readable streams and SDK stream types
  const chunks: Uint8Array[] = [];
  const readable = stream as AsyncIterable<Uint8Array>;
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Lambda Handler ─────────────────────────────────────────────────────────

/**
 * SQS batch handler for thumbnail generation.
 * Reports individual item failures for SQS retry (Requirement 8.5).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Thumbnail processing failed', {
        messageId: record.messageId,
        error: message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
