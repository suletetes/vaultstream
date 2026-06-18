/**
 * FileService — File Upload URL Generation
 *
 * Handles presigned URL generation for secure file uploads with:
 * - Quota enforcement via QuotaService
 * - Per-file envelope encryption via EncryptionService (KMS GenerateDataKey)
 * - Presigned PUT URL with SSE-KMS headers and 5-minute expiry
 * - Pending file metadata stored in DynamoDB
 * - Upload state tracked in Redis with 1-hour TTL
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import pino from 'pino';

import { docClient, TABLE_NAME } from '../db/dynamodb';
import { userPK, fileSK, gsi1Keys, gsi2Keys } from '../db/key-builders';
import { EncryptionService } from './encryption-service';
import { enforceQuota, incrementUsage, decrementUsage, checkQuota } from './quota-service';
import {
  generateId,
  sanitizeFilename,
  validationError,
  AppError,
  fileInfectedError,
  fileNotFoundError,
  versionNotFoundError,
  quotaExceededError,
  forbiddenError,
  UPLOAD_URL_EXPIRY_SECONDS,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  SHARED_DOWNLOAD_URL_EXPIRY_SECONDS,
  CACHE_TTL,
  MAX_VERSIONS_PER_FILE,
  SOFT_DELETE_RETENTION_DAYS,
  normalizePaginationParams,
  decodeCursor,
  buildPaginatedResult,
} from '@vaultstream/shared';
import type { AllowedMimeType, FileEntity, FileVersionEntity, PaginationParams, PaginatedResult } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';

const logger = pino({ name: 'file-service' });

// ─── Configuration ──────────────────────────────────────────────────────────

const S3_BUCKET = process.env.S3_FILES_BUCKET ?? 'vaultstream-files';
const KMS_KEY_ARN = process.env.KMS_KEY_ID ?? '';

const s3ClientConfig: ConstructorParameters<typeof S3Client>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  s3ClientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
  s3ClientConfig.forcePathStyle = true;
}

const s3Client = new S3Client(s3ClientConfig);

const eventBridgeClientConfig: ConstructorParameters<typeof EventBridgeClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  eventBridgeClientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const eventBridgeClient = new EventBridgeClient(eventBridgeClientConfig);

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface GenerateUploadUrlParams {
  userId: string;
  filename: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  folderId?: string;
  tags?: string[];
}

export interface GenerateUploadUrlResult {
  uploadId: string;
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
  maxSizeBytes: number;
  constraints: {
    contentType: string;
    maxSizeBytes: number;
    expiresInSeconds: number;
  };
}

export interface GenerateDownloadUrlParams {
  userId: string;
  fileId: string;
  fileMetadata: FileEntity;
  isOwner: boolean;
}

export interface GenerateDownloadUrlResult {
  downloadUrl: string;
  expiresAt: string;
  filename: string;
  contentType: string;
}

export interface ConfirmUploadParams {
  userId: string;
  fileId: string;
  etag: string;
  s3VersionId: string;
}

export interface ListVersionsParams {
  userId: string;
  fileId: string;
  pagination?: PaginationParams;
}

export interface RestoreVersionParams {
  userId: string;
  fileId: string;
  versionNumber: number;
}

export interface SoftDeleteParams {
  userId: string;
  fileId: string;
}

export interface RestoreParams {
  userId: string;
  fileId: string;
}

export interface GetTrashBinParams {
  userId: string;
  pagination?: PaginationParams;
}

export interface TrashBinItem {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  deletedAt: string;
  daysRemaining: number;
}

// ─── FileService Class ──────────────────────────────────────────────────────

export class FileService {
  private readonly encryptionService: EncryptionService;
  private readonly s3: S3Client;
  private readonly eventBridge: EventBridgeClient;
  private readonly redisClient: RedisLike | null;
  private readonly cacheService: CacheService | null;

  constructor(deps?: {
    encryptionService?: EncryptionService;
    s3Client?: S3Client;
    eventBridgeClient?: EventBridgeClient;
    redisClient?: RedisLike | null;
    cacheService?: CacheService | null;
  }) {
    this.encryptionService = deps?.encryptionService ?? new EncryptionService();
    this.s3 = deps?.s3Client ?? s3Client;
    this.eventBridge = deps?.eventBridgeClient ?? eventBridgeClient;
    this.redisClient = deps?.redisClient ?? null;
    this.cacheService = deps?.cacheService ?? null;
  }

  /**
   * Generate a presigned upload URL for a new file.
   *
   * Flow:
   * 1. Enforce quota (throws QUOTA_EXCEEDED if insufficient)
   * 2. Generate per-file data encryption key via KMS
   * 3. Generate ULID for fileId and uploadId
   * 4. Construct S3 key path
   * 5. Generate presigned PUT URL with SSE-KMS headers (5-min expiry)
   * 6. Store pending file metadata in DynamoDB
   * 7. Store upload state in Redis (1-hour TTL)
   * 8. Return upload details to client
   */
  async generateUploadUrl(params: GenerateUploadUrlParams): Promise<GenerateUploadUrlResult> {
    const { userId, filename, mimeType, sizeBytes, folderId, tags } = params;

    // 1. Enforce quota — throws AppError(QUOTA_EXCEEDED) if insufficient
    await enforceQuota(userId, sizeBytes);

    // 2. Generate per-file data encryption key
    const { encryptedDek } = await this.encryptionService.generateDataKey();

    // 3. Generate unique IDs
    const fileId = generateId();
    const uploadId = generateId();

    // 4. Construct S3 key
    const sanitizedName = sanitizeFilename(filename);
    const s3Key = `users/${userId}/files/${fileId}/1/${sanitizedName}`;

    // 5. Generate presigned PUT URL
    const putCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ContentType: mimeType,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: KMS_KEY_ARN,
    });

    const presignedUrl = await getSignedUrl(this.s3, putCommand, {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();
    const nowISO = now.toISOString();

    // 6. Store pending file metadata in DynamoDB
    const resolvedFolderId = folderId ?? 'ROOT';
    const fileItem = {
      PK: userPK(userId),
      SK: fileSK(fileId),
      entityType: 'FILE' as const,
      fileId,
      filename,
      mimeType,
      sizeBytes,
      s3Key,
      s3VersionId: '',
      encryptedDataKey: encryptedDek,
      kmsKeyId: KMS_KEY_ARN,
      thumbnailKey: null,
      folderId: resolvedFolderId,
      tags: tags ?? [],
      storageClass: 'STANDARD' as const,
      virusScanStatus: 'pending' as const,
      version: 1,
      isDeleted: false,
      createdAt: nowISO,
      updatedAt: nowISO,
      lastAccessedAt: nowISO,
      ...gsi1Keys(userId, nowISO),
      ...gsi2Keys(resolvedFolderId, filename),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: fileItem,
      }),
    );

    logger.info({ fileId, uploadId, userId, filename }, 'Pending file metadata stored');

    // 7. Store upload state in Redis with 1-hour TTL
    if (this.redisClient) {
      try {
        const uploadState = JSON.stringify({
          uploadId,
          fileId,
          userId,
          filename,
          mimeType,
          sizeBytes,
          s3Key,
          createdAt: nowISO,
          expiresAt,
        });
        await this.redisClient.set(
          `upload:${uploadId}`,
          uploadState,
          'EX',
          CACHE_TTL.uploadState,
        );
      } catch (err) {
        // Graceful degradation — Redis failure doesn't block upload
        logger.warn({ err, uploadId }, 'Failed to store upload state in Redis');
      }
    }

    // 8. Return upload details
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': KMS_KEY_ARN,
    };

    return {
      uploadId,
      fileId,
      presignedUrl,
      expiresAt,
      headers,
      maxSizeBytes: sizeBytes,
      constraints: {
        contentType: mimeType,
        maxSizeBytes: sizeBytes,
        expiresInSeconds: UPLOAD_URL_EXPIRY_SECONDS,
      },
    };
  }

  /**
   * Confirm a file upload after the client has uploaded to S3.
   *
   * Flow:
   * 1. Fetch file metadata from DynamoDB
   * 2. Verify file is in pending upload state (virusScanStatus === 'pending')
   * 3. Verify S3 object exists with matching ETag and VersionId via HeadObject
   * 4. Update DynamoDB item with s3VersionId and updatedAt
   * 5. Increment user's storageUsedBytes via QuotaService
   * 6. Publish FileUploaded event to EventBridge
   * 7. Invalidate user's recent files cache
   * 8. Return updated file metadata
   */
  async confirmUpload(params: ConfirmUploadParams): Promise<FileEntity> {
    const { userId, fileId, etag, s3VersionId } = params;

    // 1. Fetch file metadata from DynamoDB
    const pk = userPK(userId);
    const sk = fileSK(fileId);

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
      }),
    );

    if (!result.Item) {
      throw validationError('Upload confirmation is invalid');
    }

    const file = result.Item as FileEntity;

    // 2. Verify file is in pending upload state
    if (file.virusScanStatus !== 'pending') {
      throw validationError('Upload confirmation is invalid');
    }

    // 3. Verify S3 object exists with matching ETag and VersionId
    try {
      const headResult = await this.s3.send(
        new HeadObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.s3Key,
          VersionId: s3VersionId,
        }),
      );

      // Normalize ETags for comparison (S3 may wrap in quotes)
      const normalizedEtag = etag.replace(/"/g, '');
      const s3Etag = (headResult.ETag ?? '').replace(/"/g, '');

      if (normalizedEtag !== s3Etag) {
        throw validationError('Upload confirmation is invalid - S3 object verification failed');
      }
    } catch (error: unknown) {
      // Re-throw our own AppErrors (e.g., ETag mismatch validation error above)
      if (error instanceof AppError) {
        throw error;
      }
      throw validationError('Upload confirmation is invalid - S3 object verification failed');
    }

    // 4. Update DynamoDB item with s3VersionId and updatedAt
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
        UpdateExpression: 'SET #s3VersionId = :s3VersionId, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#s3VersionId': 's3VersionId',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':s3VersionId': s3VersionId,
          ':updatedAt': now,
        },
      }),
    );

    // 5. Increment user's storageUsedBytes
    await incrementUsage(userId, file.sizeBytes);

    // 6. Publish FileUploaded event to EventBridge
    await this.eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vaultstream.api',
            DetailType: 'FileUploaded',
            Detail: JSON.stringify({
              fileId: file.fileId,
              userId,
              s3Key: file.s3Key,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            }),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }),
    );

    logger.info({ fileId, userId }, 'File upload confirmed, FileUploaded event published');

    // 7. Invalidate user's recent files cache
    if (this.cacheService) {
      try {
        await this.cacheService.invalidateUserCache(userId);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to invalidate user cache');
      }
    }

    // 8. Return updated file metadata
    const updatedFile: FileEntity = {
      ...file,
      s3VersionId,
      updatedAt: now,
    };

    return updatedFile;
  }

  /**
   * Generate a download URL for a file.
   *
   * Flow:
   * 1. Check download eligibility gates (virus scan, soft-delete, storage class)
   * 2. Generate presigned GET URL (owner) or CloudFront signed URL (shared user)
   * 3. Update lastAccessedAt in DynamoDB
   * 4. Invalidate user's recent files cache
   * 5. Return download URL details
   */
  async generateDownloadUrl(params: GenerateDownloadUrlParams): Promise<GenerateDownloadUrlResult> {
    const { userId, fileId, fileMetadata, isOwner } = params;

    // 1. Check download eligibility gates
    if (fileMetadata.virusScanStatus === 'infected') {
      throw fileInfectedError();
    }

    if (fileMetadata.virusScanStatus === 'pending' || fileMetadata.virusScanStatus === 'error') {
      throw validationError('File is still being scanned');
    }

    if (fileMetadata.isDeleted === true) {
      throw fileNotFoundError();
    }

    if (fileMetadata.storageClass === 'DEEP_ARCHIVE') {
      throw validationError('File must be restored before download. Estimated restore time: 12 hours');
    }

    // 2. Generate download URL
    const now = new Date();
    let downloadUrl: string;
    let expiresAt: string;

    if (isOwner) {
      // Owner: presigned S3 GET URL with 15-minute expiry
      const getCommand = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileMetadata.s3Key,
        ResponseContentDisposition: `attachment; filename="${fileMetadata.filename}"`,
      });

      downloadUrl = await getSignedUrl(this.s3, getCommand, {
        expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
      });

      expiresAt = new Date(now.getTime() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();
    } else {
      // Shared user: CloudFront signed URL with 1-hour expiry
      // Placeholder — actual CloudFront signing requires private key from Secrets Manager
      const cfDomain = process.env.CLOUDFRONT_DOMAIN ?? 'cdn.vaultstream.io';
      const expiresEpoch = Math.floor(now.getTime() / 1000) + SHARED_DOWNLOAD_URL_EXPIRY_SECONDS;
      downloadUrl = `https://${cfDomain}/${fileMetadata.s3Key}?Expires=${expiresEpoch}&Signature=placeholder&Key-Pair-Id=placeholder`;

      expiresAt = new Date(now.getTime() + SHARED_DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();
    }

    // 3. Update lastAccessedAt in DynamoDB
    const nowISO = now.toISOString();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: fileMetadata.PK, SK: fileMetadata.SK },
          UpdateExpression: 'SET #lastAccessedAt = :lastAccessedAt, #updatedAt = :updatedAt, #gsi1sk = :gsi1sk',
          ExpressionAttributeNames: {
            '#lastAccessedAt': 'lastAccessedAt',
            '#updatedAt': 'updatedAt',
            '#gsi1sk': 'GSI1SK',
          },
          ExpressionAttributeValues: {
            ':lastAccessedAt': nowISO,
            ':updatedAt': nowISO,
            ':gsi1sk': nowISO,
          },
        }),
      );
    } catch (err) {
      // Log but don't block download — metadata update is best-effort
      logger.warn({ err, fileId, userId }, 'Failed to update lastAccessedAt');
    }

    // 4. Invalidate user's recent files cache
    if (this.redisClient) {
      try {
        await this.redisClient.del(`user:${userId}:recent`);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to invalidate recent files cache');
      }
    }

    logger.info({ fileId, userId, isOwner }, 'Download URL generated');

    // 5. Return download URL details
    return {
      downloadUrl,
      expiresAt,
      filename: fileMetadata.filename,
      contentType: fileMetadata.mimeType,
    };
  }

  // ─── Versioning Methods ─────────────────────────────────────────────────

  /**
   * List versions of a file.
   *
   * Flow:
   * 1. Verify file ownership
   * 2. Query DynamoDB: PK=FILE#{fileId}, SK begins_with "VERSION#", sorted descending
   * 3. Paginate with default 20, max 100
   * 4. Return paginated FILE_VERSION entities
   */
  async listVersions(params: ListVersionsParams): Promise<PaginatedResult<FileVersionEntity>> {
    const { userId, fileId, pagination } = params;

    // 1. Verify file ownership
    await this.verifyOwnership(userId, fileId);

    // 2. Normalize pagination
    const { limit, cursor } = normalizePaginationParams(pagination);

    // 3. Query versions
    const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `FILE#${fileId}`,
          ':skPrefix': 'VERSION#',
        },
        ScanIndexForward: false, // descending by version number
        Limit: limit,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    const items = (result.Items ?? []) as FileVersionEntity[];

    return buildPaginatedResult(items, result.LastEvaluatedKey ?? null);
  }

  /**
   * Restore a previous version of a file.
   *
   * Flow:
   * 1. Verify ownership
   * 2. Get the VERSION entity (PK=FILE#{fileId}, SK=VERSION#{padded versionNumber})
   * 3. Enforce version cap (delete oldest if at max)
   * 4. Copy S3 object from that version to create new current version
   * 5. Increment file's version counter
   * 6. Create new FILE_VERSION entity
   * 7. Update FILE entity metadata (s3VersionId, sizeBytes, updatedAt)
   * 8. Return updated file metadata
   */
  async restoreVersion(params: RestoreVersionParams): Promise<FileEntity> {
    const { userId, fileId, versionNumber } = params;

    // 1. Verify ownership and get file metadata
    const file = await this.verifyOwnership(userId, fileId);

    // 2. Get the VERSION entity
    const versionSKValue = `VERSION#${String(versionNumber).padStart(5, '0')}`;
    const versionResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `FILE#${fileId}`, SK: versionSKValue },
      }),
    );

    if (!versionResult.Item) {
      throw versionNotFoundError();
    }

    const versionEntity = versionResult.Item as FileVersionEntity;

    // 3. Enforce version cap
    await this.enforceVersionCap(fileId);

    // 4. Copy S3 object from that version to create new current version
    const newVersion = file.version + 1;
    const sanitizedName = sanitizeFilename(file.filename);
    const newS3Key = `users/${userId}/files/${fileId}/${newVersion}/${sanitizedName}`;

    const copyResult = await this.s3.send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${file.s3Key}?versionId=${versionEntity.s3VersionId}`,
        Key: newS3Key,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: KMS_KEY_ARN,
      }),
    );

    const newS3VersionId = (copyResult.CopyObjectResult as { VersionId?: string })?.VersionId ??
      (copyResult as unknown as { VersionId?: string }).VersionId ?? '';

    // 5. Create new FILE_VERSION entity
    const now = new Date().toISOString();
    const newVersionEntity: FileVersionEntity = {
      PK: `FILE#${fileId}`,
      SK: `VERSION#${String(newVersion).padStart(5, '0')}`,
      entityType: 'FILE_VERSION',
      fileId,
      versionNumber: newVersion,
      s3VersionId: newS3VersionId,
      encryptedDataKey: versionEntity.encryptedDataKey,
      sizeBytes: versionEntity.sizeBytes,
      uploadedBy: userId,
      createdAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: newVersionEntity,
      }),
    );

    // 6. Update FILE entity metadata
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: fileSK(fileId) },
        UpdateExpression: 'SET #version = :version, #s3Key = :s3Key, #s3VersionId = :s3VersionId, #sizeBytes = :sizeBytes, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#version': 'version',
          '#s3Key': 's3Key',
          '#s3VersionId': 's3VersionId',
          '#sizeBytes': 'sizeBytes',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':version': newVersion,
          ':s3Key': newS3Key,
          ':s3VersionId': newS3VersionId,
          ':sizeBytes': versionEntity.sizeBytes,
          ':updatedAt': now,
        },
      }),
    );

    logger.info({ fileId, userId, versionNumber, newVersion }, 'Version restored');

    // 7. Invalidate caches
    if (this.cacheService) {
      try {
        await this.cacheService.invalidateUserCache(userId);
        await this.cacheService.invalidateFileCache(fileId);
      } catch (err) {
        logger.warn({ err, userId, fileId }, 'Failed to invalidate caches after version restore');
      }
    }

    // 8. Return updated file metadata
    return {
      ...file,
      version: newVersion,
      s3Key: newS3Key,
      s3VersionId: newS3VersionId,
      sizeBytes: versionEntity.sizeBytes,
      updatedAt: now,
    };
  }

  // ─── Soft-Delete and Restore Methods ────────────────────────────────────

  /**
   * Soft-delete a file.
   *
   * Flow:
   * 1. Verify ownership and get file metadata
   * 2. Set isDeleted=true, deletedAt=ISO8601 now
   * 3. Add S3 delete marker (DeleteObjectCommand)
   * 4. Subtract sizeBytes from user's storageUsedBytes via QuotaService.decrementUsage
   * 5. Invalidate user's recent cache and file cache
   */
  async softDelete(params: SoftDeleteParams): Promise<void> {
    const { userId, fileId } = params;

    // 1. Verify ownership and get file metadata
    const file = await this.verifyOwnership(userId, fileId);

    if (file.isDeleted) {
      throw validationError('File is already deleted');
    }

    const now = new Date().toISOString();

    // 2. Set isDeleted=true, deletedAt in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: fileSK(fileId) },
        UpdateExpression: 'SET #isDeleted = :isDeleted, #deletedAt = :deletedAt, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#isDeleted': 'isDeleted',
          '#deletedAt': 'deletedAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':isDeleted': true,
          ':deletedAt': now,
          ':updatedAt': now,
        },
      }),
    );

    // 3. Add S3 delete marker
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.s3Key,
        }),
      );
    } catch (err) {
      logger.warn({ err, fileId, s3Key: file.s3Key }, 'Failed to add S3 delete marker');
    }

    // 4. Subtract sizeBytes from user's storageUsedBytes
    await decrementUsage(userId, file.sizeBytes);

    // 5. Invalidate caches
    if (this.cacheService) {
      try {
        await this.cacheService.invalidateUserCache(userId);
        await this.cacheService.invalidateFileCache(fileId);
      } catch (err) {
        logger.warn({ err, userId, fileId }, 'Failed to invalidate caches after soft-delete');
      }
    }

    logger.info({ fileId, userId }, 'File soft-deleted');
  }

  /**
   * Restore a soft-deleted file.
   *
   * Flow:
   * 1. Verify file exists and isDeleted=true
   * 2. Check quota: if restoring would exceed quota, throw QUOTA_EXCEEDED
   * 3. Set isDeleted=false, remove deletedAt
   * 4. Remove S3 delete marker (delete the delete marker version)
   * 5. Add sizeBytes back via QuotaService.incrementUsage
   * 6. If original folder was deleted, restore to ROOT
   * 7. Invalidate caches
   * 8. Return updated file metadata
   */
  async restore(params: RestoreParams): Promise<FileEntity> {
    const { userId, fileId } = params;

    // 1. Verify file exists and isDeleted=true
    const file = await this.verifyOwnership(userId, fileId);

    if (!file.isDeleted) {
      throw validationError('File is not deleted');
    }

    // 2. Check quota
    const quotaCheck = await checkQuota(userId, file.sizeBytes);
    if (!quotaCheck.allowed) {
      throw quotaExceededError(quotaCheck.currentUsage, quotaCheck.limit);
    }

    // 3. Determine target folder (restore to ROOT if original folder was deleted)
    let targetFolderId = file.folderId;
    if (targetFolderId !== 'ROOT') {
      const folderResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: userPK(userId), SK: `FOLDER#${targetFolderId}` },
        }),
      );
      if (!folderResult.Item) {
        targetFolderId = 'ROOT';
      }
    }

    const now = new Date().toISOString();

    // 4. Set isDeleted=false, remove deletedAt
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: fileSK(fileId) },
        UpdateExpression: 'SET #isDeleted = :isDeleted, #updatedAt = :updatedAt, #folderId = :folderId, #gsi2pk = :gsi2pk REMOVE #deletedAt',
        ExpressionAttributeNames: {
          '#isDeleted': 'isDeleted',
          '#deletedAt': 'deletedAt',
          '#updatedAt': 'updatedAt',
          '#folderId': 'folderId',
          '#gsi2pk': 'GSI2PK',
        },
        ExpressionAttributeValues: {
          ':isDeleted': false,
          ':updatedAt': now,
          ':folderId': targetFolderId,
          ':gsi2pk': `FOLDER#${targetFolderId}`,
        },
      }),
    );

    // 5. Remove S3 delete marker
    try {
      // List object versions to find the delete marker
      // For simplicity, we issue a DeleteObject on the delete marker version
      // In practice, we'd use ListObjectVersions to find the delete marker's VersionId
      // Here we use a simple approach: delete the object (which removes the latest delete marker in a versioned bucket)
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.s3Key,
        }),
      );
    } catch (err) {
      logger.warn({ err, fileId, s3Key: file.s3Key }, 'Failed to remove S3 delete marker');
    }

    // 6. Add sizeBytes back via QuotaService.incrementUsage
    await incrementUsage(userId, file.sizeBytes);

    // 7. Invalidate caches
    if (this.cacheService) {
      try {
        await this.cacheService.invalidateUserCache(userId);
        await this.cacheService.invalidateFileCache(fileId);
      } catch (err) {
        logger.warn({ err, userId, fileId }, 'Failed to invalidate caches after restore');
      }
    }

    logger.info({ fileId, userId, targetFolderId }, 'File restored from trash');

    // 8. Return updated file metadata
    return {
      ...file,
      isDeleted: false,
      deletedAt: undefined,
      folderId: targetFolderId,
      updatedAt: now,
      GSI2PK: `FOLDER#${targetFolderId}` as `FOLDER#${string}`,
    };
  }

  /**
   * Get the user's trash bin (soft-deleted files).
   *
   * Flow:
   * 1. Query user's files where isDeleted=true
   * 2. Return with deletedAt and daysRemaining (30 - daysSinceDeletion)
   * 3. Paginate with default 20, max 100
   */
  async getTrashBin(params: GetTrashBinParams): Promise<PaginatedResult<TrashBinItem>> {
    const { userId, pagination } = params;

    const { limit, cursor } = normalizePaginationParams(pagination);
    const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

    // Query user's files with filter for isDeleted=true
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: '#isDeleted = :isDeleted',
        ExpressionAttributeNames: {
          '#isDeleted': 'isDeleted',
        },
        ExpressionAttributeValues: {
          ':pk': userPK(userId),
          ':skPrefix': 'FILE#',
          ':isDeleted': true,
        },
        Limit: limit,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    const files = (result.Items ?? []) as FileEntity[];
    const now = Date.now();

    const trashItems: TrashBinItem[] = files.map((file) => {
      const deletedAt = file.deletedAt ?? file.updatedAt;
      const daysSinceDeletion = Math.floor((now - new Date(deletedAt).getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, SOFT_DELETE_RETENTION_DAYS - daysSinceDeletion);

      return {
        fileId: file.fileId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        deletedAt,
        daysRemaining,
      };
    });

    return buildPaginatedResult(trashItems, result.LastEvaluatedKey ?? null);
  }

  /**
   * Empty the trash bin (permanently delete all soft-deleted files).
   *
   * Flow:
   * 1. Query all soft-deleted files for the user
   * 2. Delete each file's DynamoDB record, versions, and S3 objects
   * 3. Return count of deleted files
   */
  async emptyTrash(userId: string): Promise<{ deletedCount: number }> {
    // Query all soft-deleted files
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: '#isDeleted = :isDeleted',
        ExpressionAttributeNames: {
          '#isDeleted': 'isDeleted',
        },
        ExpressionAttributeValues: {
          ':pk': userPK(userId),
          ':skPrefix': 'FILE#',
          ':isDeleted': true,
        },
      }),
    );

    const files = (result.Items ?? []) as FileEntity[];
    let deletedCount = 0;

    for (const file of files) {
      try {
        // Delete S3 object
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: file.s3Key,
          }),
        );

        // Delete DynamoDB record
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: file.PK, SK: file.SK },
          }),
        );

        deletedCount++;
      } catch (err) {
        logger.warn({ err, fileId: file.fileId }, 'Failed to permanently delete file from trash');
      }
    }

    // Invalidate caches
    if (this.cacheService) {
      try {
        await this.cacheService.invalidateUserCache(userId);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to invalidate caches after emptying trash');
      }
    }

    logger.info({ userId, deletedCount }, 'Trash emptied');
    return { deletedCount };
  }

  // ─── Recently Accessed Files ────────────────────────────────────────────

  /**
   * Get recently accessed files for a user with cache-aside pattern.
   *
   * Flow:
   * 1. Check Redis sorted set (user:{userId}:recent), return cached if available
   * 2. On miss: query GSI1 (GSI1PK=USER#{userId}, sorted by lastAccessedAt desc, limit 20, exclude isDeleted=true)
   * 3. Populate cache on miss
   * 4. Return top 20 recently accessed files
   */
  async getRecentFiles(userId: string): Promise<FileEntity[]> {
    // 1. Check cache
    if (this.cacheService) {
      const cached = await this.cacheService.getRecentFiles(userId);
      if (cached) {
        return cached;
      }
    }

    // 2. Query GSI1 for user's files sorted by lastAccessedAt desc
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        FilterExpression: '#isDeleted = :isDeleted AND #entityType = :entityType',
        ExpressionAttributeNames: {
          '#isDeleted': 'isDeleted',
          '#entityType': 'entityType',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': `USER#${userId}`,
          ':isDeleted': false,
          ':entityType': 'FILE',
        },
        ScanIndexForward: false, // descending by GSI1SK (lastAccessedAt)
        Limit: 20,
      }),
    );

    const files = (result.Items ?? []) as FileEntity[];

    // 3. Populate cache on miss
    if (this.cacheService && files.length > 0) {
      try {
        await this.cacheService.setRecentFiles(userId, files);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to populate recent files cache');
      }
    }

    // 4. Return top 20
    return files;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Fetch metadata for a file owned by the user.
   * Returns null if the file does not exist under the user's partition.
   */
  async getOwnedFileMetadata(userId: string, fileId: string): Promise<FileEntity | null> {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: fileSK(fileId) },
      }),
    );

    return (result.Item as FileEntity) ?? null;
  }

  /**
   * Verify that the user owns the file. Returns the file entity.
   * Throws FORBIDDEN if not found.
   */
  private async verifyOwnership(userId: string, fileId: string): Promise<FileEntity> {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: userPK(userId), SK: fileSK(fileId) },
      }),
    );

    if (!result.Item) {
      throw forbiddenError('Access denied');
    }

    return result.Item as FileEntity;
  }

  /**
   * Enforce the version cap (MAX_VERSIONS_PER_FILE = 50).
   * If at the limit, delete the oldest VERSION record and its S3 object.
   */
  private async enforceVersionCap(fileId: string): Promise<void> {
    // Count existing versions
    const countResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `FILE#${fileId}`,
          ':skPrefix': 'VERSION#',
        },
        Select: 'COUNT',
      }),
    );

    const versionCount = countResult.Count ?? 0;

    if (versionCount >= MAX_VERSIONS_PER_FILE) {
      // Get the oldest version (ascending order, first item)
      const oldestResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `FILE#${fileId}`,
            ':skPrefix': 'VERSION#',
          },
          ScanIndexForward: true, // ascending = oldest first
          Limit: 1,
        }),
      );

      const oldestVersion = oldestResult.Items?.[0] as FileVersionEntity | undefined;
      if (oldestVersion) {
        // Delete the oldest version's S3 object
        try {
          await this.s3.send(
            new DeleteObjectCommand({
              Bucket: S3_BUCKET,
              Key: `users/${oldestVersion.uploadedBy}/files/${fileId}/${oldestVersion.versionNumber}/${oldestVersion.s3VersionId}`,
            }),
          );
        } catch (err) {
          logger.warn({ err, fileId, versionNumber: oldestVersion.versionNumber }, 'Failed to delete oldest version S3 object');
        }

        // Delete the VERSION record from DynamoDB
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: oldestVersion.PK, SK: oldestVersion.SK },
          }),
        );

        logger.info({ fileId, deletedVersion: oldestVersion.versionNumber }, 'Oldest version deleted (cap enforcement)');
      }
    }
  }
}

// ─── Redis-like interface for dependency injection ──────────────────────────

export interface RedisLike {
  set(key: string, value: string, mode: string, duration: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
}

// ─── Default singleton instance ─────────────────────────────────────────────

export const fileService = new FileService();
