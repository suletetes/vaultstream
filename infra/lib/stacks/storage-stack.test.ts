import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeEach } from 'vitest';
import { StorageStack } from './storage-stack';
import { devConfig } from '../config';

describe('StorageStack', () => {
  let app: cdk.App;
  let stack: StorageStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new StorageStack(app, 'TestStorageStack', {
      config: devConfig,
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('Files Bucket', () => {
    it('should create files bucket with versioning enabled', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    it('should configure BlockPublicAccess on files bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('should configure CORS on files bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        CorsConfiguration: {
          CorsRules: [
            Match.objectLike({
              AllowedOrigins: ['https://app.vaultstream.dev', 'http://localhost:3000'],
              AllowedMethods: ['GET', 'PUT', 'HEAD'],
            }),
          ],
        },
      });
    });

    it('should configure lifecycle transitions for current versions', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'CurrentVersionTransitions',
              Status: 'Enabled',
              Transitions: Match.arrayWith([
                Match.objectLike({
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 30,
                }),
                Match.objectLike({
                  StorageClass: 'GLACIER_IR',
                  TransitionInDays: 90,
                }),
                Match.objectLike({
                  StorageClass: 'DEEP_ARCHIVE',
                  TransitionInDays: 365,
                }),
              ]),
            }),
          ]),
        },
      });
    });

    it('should configure noncurrent version transitions and expiration', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'NoncurrentVersionTransitions',
              Status: 'Enabled',
              NoncurrentVersionTransitions: Match.arrayWith([
                Match.objectLike({
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 7,
                }),
                Match.objectLike({
                  StorageClass: 'GLACIER_IR',
                  TransitionInDays: 30,
                }),
              ]),
              NoncurrentVersionExpiration: Match.objectLike({
                NoncurrentDays: 90,
              }),
            }),
          ]),
        },
      });
    });

    it('should configure incomplete multipart upload cleanup (7 days)', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'AbortIncompleteMultipartUploads',
              Status: 'Enabled',
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 7,
              },
            }),
          ]),
        },
      });
    });

    it('should configure expired delete marker cleanup', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'ExpiredDeleteMarkerCleanup',
              Status: 'Enabled',
            }),
          ]),
        },
      });
    });

    it('should enforce SSE-KMS via bucket policy', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'DenyUnencryptedObjectUploads',
              Effect: 'Deny',
              Action: 's3:PutObject',
              Condition: {
                StringNotEquals: {
                  's3:x-amz-server-side-encryption': 'aws:kms',
                },
              },
            }),
            Match.objectLike({
              Sid: 'DenyMissingEncryptionHeader',
              Effect: 'Deny',
              Action: 's3:PutObject',
              Condition: {
                Null: {
                  's3:x-amz-server-side-encryption': 'true',
                },
              },
            }),
          ]),
        },
      });
    });

    it('should enable BucketKeyEnabled for KMS cost reduction', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({
              BucketKeyEnabled: true,
            }),
          ],
        },
      });
    });
  });

  describe('Thumbnails Bucket', () => {
    it('should create thumbnails bucket with SSE-S3 encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-thumbnails-'),
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            }),
          ],
        },
      });
    });

    it('should configure 365-day lifecycle on thumbnails bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-thumbnails-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'ExpireThumbnailsAfter365Days',
              Status: 'Enabled',
              ExpirationInDays: 365,
            }),
          ]),
        },
      });
    });
  });

  describe('Frontend Bucket', () => {
    it('should create frontend bucket with BlockPublicAccess', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-frontend-'),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('should configure website hosting for SPA', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-frontend-'),
        WebsiteConfiguration: {
          IndexDocument: 'index.html',
          ErrorDocument: 'index.html',
        },
      });
    });
  });

  describe('Access Logs Bucket', () => {
    it('should create access logs bucket with 90-day expiration', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-access-logs-'),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'ExpireLogsAfter90Days',
              Status: 'Enabled',
              ExpirationInDays: 90,
            }),
          ]),
        },
      });
    });
  });

  describe('Stack Outputs', () => {
    it('should export bucket names as CloudFormation outputs', () => {
      template.hasOutput('FilesBucketName', {});
      template.hasOutput('ThumbnailsBucketName', {});
      template.hasOutput('FrontendBucketName', {});
      template.hasOutput('AccessLogsBucketName', {});
    });
  });

  describe('Exported properties', () => {
    it('should expose all four buckets as public properties', () => {
      expect(stack.filesBucket).toBeDefined();
      expect(stack.thumbnailsBucket).toBeDefined();
      expect(stack.frontendBucket).toBeDefined();
      expect(stack.accessLogsBucket).toBeDefined();
    });
  });

  describe('With KMS key ARN', () => {
    it('should use KMS encryption when kmsKeyArn is provided', () => {
      const appWithKms = new cdk.App();
      const stackWithKms = new StorageStack(appWithKms, 'TestStorageStackKms', {
        config: devConfig,
        kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/test-key-id',
        env: { account: '123456789012', region: 'us-east-1' },
      });
      const templateWithKms = Template.fromStack(stackWithKms);

      templateWithKms.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('vaultstream-dev-files-'),
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
              },
              BucketKeyEnabled: true,
            }),
          ],
        },
      });
    });
  });
});
