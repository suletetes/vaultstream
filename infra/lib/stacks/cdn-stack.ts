import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the CdnStack.
 */
export interface CdnStackProps extends cdk.StackProps {
  /** Environment configuration */
  config: EnvironmentConfig;
  /** S3 frontend bucket name (imported by name to avoid circular cross-stack refs) */
  frontendBucketName: string;
  /** S3 thumbnails bucket name (imported by name to avoid circular cross-stack refs) */
  thumbnailsBucketName: string;
  /** WAF WebACL ARN for association with distributions (optional — only in prod) */
  webAclArn?: string;
}

/**
 * VaultStream CDN Stack
 *
 * Provisions CloudFront distributions for:
 * - Frontend SPA delivery with OAC, 24h cache, gzip/brotli, custom error pages
 * - Thumbnails delivery with OAC and CachingOptimized policy
 *
 * Also configures a shared security response headers policy with:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
 * - Content-Security-Policy: default-src 'self'
 *
 * Requirements: 17.1, 17.2, 17.4, 17.5, 17.6, 17.7
 */
export class CdnStack extends cdk.Stack {
  /** CloudFront distribution for frontend SPA */
  public readonly frontendDistribution: cloudfront.Distribution;
  /** CloudFront distribution for thumbnails */
  public readonly thumbnailsDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);

    const { config, frontendBucketName, thumbnailsBucketName, webAclArn } = props;

    // Import buckets by name to avoid circular cross-stack references with OAC
    const frontendBucket = s3.Bucket.fromBucketName(this, 'FrontendBucketRef', frontendBucketName);
    const thumbnailsBucket = s3.Bucket.fromBucketName(this, 'ThumbnailsBucketRef', thumbnailsBucketName);

    // =========================================================================
    // Security Response Headers Policy (Requirement 17.7)
    // =========================================================================
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecurityHeadersPolicy',
      {
        responseHeadersPolicyName: `${config.prefix}-security-headers`,
        comment: 'VaultStream security response headers',
        securityHeadersBehavior: {
          contentTypeOptions: {
            override: true,
          },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(63072000),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentSecurityPolicy: {
            contentSecurityPolicy: "default-src 'self'",
            override: true,
          },
        },
      },
    );

    // =========================================================================
    // Frontend Distribution (Requirement 17.5)
    // Origin: S3 frontend bucket with OAC
    // Default cache behavior: 24h TTL, compress (gzip/brotli)
    // Custom error responses: 403→/index.html (200), 404→/index.html (200)
    // HTTPS only (redirect HTTP to HTTPS)
    // =========================================================================
    const frontendOac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      originAccessControlName: `${config.prefix}-frontend-oac`,
      description: 'OAC for VaultStream frontend SPA bucket',
    });

    this.frontendDistribution = new cloudfront.Distribution(
      this,
      'FrontendDistribution',
      {
        comment: `${config.prefix} Frontend SPA Distribution`,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
            originAccessControl: frontendOac,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, 'FrontendCachePolicy', {
            cachePolicyName: `${config.prefix}-frontend-cache`,
            comment: '24h cache for frontend SPA assets',
            defaultTtl: cdk.Duration.hours(24),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(365),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
          compress: true,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        defaultRootObject: 'index.html',
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
        ],
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        webAclId: webAclArn,
        enabled: true,
      },
    );

    // =========================================================================
    // Thumbnails Distribution (Requirement 17.1)
    // Origin: S3 thumbnails bucket with OAC
    // Default cache behavior: CachingOptimized policy, compress
    // HTTPS only
    // =========================================================================
    const thumbnailsOac = new cloudfront.S3OriginAccessControl(
      this,
      'ThumbnailsOAC',
      {
        originAccessControlName: `${config.prefix}-thumbnails-oac`,
        description: 'OAC for VaultStream thumbnails bucket',
      },
    );

    this.thumbnailsDistribution = new cloudfront.Distribution(
      this,
      'ThumbnailsDistribution',
      {
        comment: `${config.prefix} Thumbnails Distribution`,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(thumbnailsBucket, {
            originAccessControl: thumbnailsOac,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        enabled: true,
      },
    );

    // =========================================================================
    // CloudFormation Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'FrontendDistributionId', {
      value: this.frontendDistribution.distributionId,
      description: 'Frontend CloudFront Distribution ID',
      exportName: `${config.prefix}-frontend-distribution-id`,
    });

    new cdk.CfnOutput(this, 'FrontendDistributionDomain', {
      value: this.frontendDistribution.distributionDomainName,
      description: 'Frontend CloudFront Distribution Domain Name',
      exportName: `${config.prefix}-frontend-distribution-domain`,
    });

    new cdk.CfnOutput(this, 'ThumbnailsDistributionId', {
      value: this.thumbnailsDistribution.distributionId,
      description: 'Thumbnails CloudFront Distribution ID',
      exportName: `${config.prefix}-thumbnails-distribution-id`,
    });

    new cdk.CfnOutput(this, 'ThumbnailsDistributionDomain', {
      value: this.thumbnailsDistribution.distributionDomainName,
      description: 'Thumbnails CloudFront Distribution Domain Name',
      exportName: `${config.prefix}-thumbnails-distribution-domain`,
    });
  }
}
