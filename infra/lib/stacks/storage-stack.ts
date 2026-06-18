import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the StorageStack.
 */
export interface StorageStackProps extends cdk.StackProps {
  /** Environment configuration */
  config: EnvironmentConfig;
  /** KMS key ARN from SecurityStack for SSE-KMS encryption (optional — creates an imported reference) */
  kmsKeyArn?: string;
}

/**
 * StorageStack provisions all S3 buckets for VaultStream:
 * - vaultstream-files: Primary encrypted file storage with lifecycle tiering
 * - vaultstream-thumbnails: Generated thumbnail storage
 * - vaultstream-frontend: SPA static hosting
 * - vaultstream-access-logs: S3 server access logs
 *
 * Requirements: 10.1, 10.2, 10.3, 10.8, 10.9, 10.10, 1.9, 40.2
 */
export class StorageStack extends cdk.Stack {
  /** Primary encrypted file storage bucket */
  public readonly filesBucket: s3.Bucket;
  /** Thumbnail storage bucket */
  public readonly thumbnailsBucket: s3.Bucket;
  /** Frontend SPA hosting bucket */
  public readonly frontendBucket: s3.Bucket;
  /** Access logs bucket */
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config, kmsKeyArn } = props;

    // Import or reference the KMS key for SSE-KMS encryption
    const encryptionKey = kmsKeyArn
      ? kms.Key.fromKeyArn(this, 'ImportedKmsKey', kmsKeyArn)
      : undefined;

    // -------------------------------------------------------------------------
    // Access Logs Bucket
    // Must be created first as other buckets reference it for server access logging.
    // -------------------------------------------------------------------------
    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${config.prefix}-access-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.deletionProtection,
      lifecycleRules: [
        {
          id: 'ExpireLogsAfter90Days',
          expiration: cdk.Duration.days(90),
          enabled: true,
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    // -------------------------------------------------------------------------
    // Files Bucket — Primary encrypted file storage
    // SSE-KMS with versioning, CORS, BlockPublicAccess, lifecycle tiering
    // Requirements: 1.9, 10.1, 10.2, 10.3, 10.8, 10.9, 10.10
    // -------------------------------------------------------------------------
    this.filesBucket = new s3.Bucket(this, 'FilesBucket', {
      bucketName: `${config.prefix}-files-${this.account}`,
      encryption: encryptionKey
        ? s3.BucketEncryption.KMS
        : s3.BucketEncryption.S3_MANAGED,
      encryptionKey: encryptionKey,
      bucketKeyEnabled: true, // Reduces KMS API calls (Requirement 11.6)
      versioned: true, // Required for file versioning (Requirement 5.1)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.deletionProtection,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'files/',
      cors: [
        {
          allowedOrigins: ['https://app.vaultstream.dev', 'http://localhost:3000'],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
          ],
          allowedHeaders: [
            'Content-Type',
            'Content-Length',
            'x-amz-server-side-encryption',
            'x-amz-server-side-encryption-aws-kms-key-id',
            'x-amz-meta-*',
            'Authorization',
          ],
          exposedHeaders: ['ETag', 'x-amz-version-id'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        // Requirement 10.1: STANDARD → STANDARD_IA after 30 days (objects ≥128KB)
        // Requirement 10.2: STANDARD_IA → GLACIER_IR after 90 days
        // Requirement 10.3: GLACIER_IR → DEEP_ARCHIVE after 365 days
        {
          id: 'CurrentVersionTransitions',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
        // Requirement 10.8: Noncurrent version transitions
        // STANDARD_IA (30d), GLACIER_IR (60d), permanent delete (90d)
        {
          id: 'NoncurrentVersionTransitions',
          enabled: true,
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(60),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
        // Requirement 10.9: Incomplete multipart upload cleanup after 7 days
        {
          id: 'AbortIncompleteMultipartUploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        // Requirement 10.10: Expired delete marker cleanup
        {
          id: 'ExpiredDeleteMarkerCleanup',
          enabled: true,
          expiredObjectDeleteMarker: true,
        },
      ],
    });

    // Requirement 1.9: Enforce SSE-KMS on all PutObject requests via bucket policy
    this.filesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyUnencryptedObjectUploads',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:PutObject'],
        resources: [this.filesBucket.arnForObjects('*')],
        conditions: {
          StringNotEquals: {
            's3:x-amz-server-side-encryption': 'aws:kms',
          },
        },
      }),
    );

    this.filesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyMissingEncryptionHeader',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:PutObject'],
        resources: [this.filesBucket.arnForObjects('*')],
        conditions: {
          Null: {
            's3:x-amz-server-side-encryption': 'true',
          },
        },
      }),
    );

    // -------------------------------------------------------------------------
    // Thumbnails Bucket — SSE-S3, 365-day lifecycle
    // -------------------------------------------------------------------------
    this.thumbnailsBucket = new s3.Bucket(this, 'ThumbnailsBucket', {
      bucketName: `${config.prefix}-thumbnails-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.deletionProtection,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'thumbnails/',
      cors: [
        {
          allowedOrigins: ['https://app.vaultstream.dev', 'http://localhost:3000'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          maxAge: 86400,
        },
      ],
      lifecycleRules: [
        {
          id: 'ExpireThumbnailsAfter365Days',
          expiration: cdk.Duration.days(365),
          enabled: true,
        },
      ],
    });

    // -------------------------------------------------------------------------
    // Frontend Bucket — SPA static hosting
    // -------------------------------------------------------------------------
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${config.prefix}-frontend-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.deletionProtection,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html', // SPA routing fallback
    });

    // -------------------------------------------------------------------------
    // CloudFormation Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'FilesBucketName', {
      value: this.filesBucket.bucketName,
      description: 'Primary encrypted file storage bucket',
      exportName: `${config.prefix}-files-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ThumbnailsBucketName', {
      value: this.thumbnailsBucket.bucketName,
      description: 'Thumbnail storage bucket',
      exportName: `${config.prefix}-thumbnails-bucket-name`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Frontend SPA hosting bucket',
      exportName: `${config.prefix}-frontend-bucket-name`,
    });

    new cdk.CfnOutput(this, 'AccessLogsBucketName', {
      value: this.accessLogsBucket.bucketName,
      description: 'S3 access logs bucket',
      exportName: `${config.prefix}-access-logs-bucket-name`,
    });
  }
}
