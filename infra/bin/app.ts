#!/usr/bin/env node
/**
 * VaultStream CDK Application Entry Point
 *
 * Instantiates all infrastructure stacks for the target environment.
 * Environment is selected via the CDK context value "env" (dev | prod).
 *
 * Stack dependency order:
 * 1. NetworkStack — VPC, subnets, security groups
 * 2. SecurityStack — KMS, Cognito, WAF
 * 3. StorageStack — S3 buckets (depends on KMS key)
 * 4. DatabaseStack — DynamoDB, RDS, Redis (depends on VPC, security groups)
 * 5. MessagingStack — SQS, SNS, EventBridge (depends on files bucket name)
 * 6. ComputeStack — Lambda, API Gateway (depends on most other stacks)
 * 7. CdnStack — CloudFront distributions (depends on S3 buckets, WAF)
 * 8. MonitoringStack — CloudWatch alarms, CloudTrail (depends on resource names)
 */

import * as cdk from 'aws-cdk-lib';
import { type EnvironmentName, getEnvironmentConfig } from '../lib/config';
import { NetworkStack } from '../lib/stacks/network-stack';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { CdnStack } from '../lib/stacks/cdn-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

const app = new cdk.App();

// Resolve target environment from CDK context (default: dev)
const envName = (app.node.tryGetContext('env') as EnvironmentName) ?? 'dev';
const config = getEnvironmentConfig(envName);

// AWS environment for stack deployment
const awsEnv: cdk.Environment = {
  account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

// Shared stack props
const stackProps: cdk.StackProps = {
  env: awsEnv,
  tags: {
    Project: 'VaultStream',
    Environment: config.envName,
    ManagedBy: 'CDK',
  },
};

// ---------------------------------------------------------------------------
// 1. Network Stack — VPC, subnets, NAT Gateways, security groups, VPC endpoints
// ---------------------------------------------------------------------------
const networkStack = new NetworkStack(app, `${config.prefix}-network`, {
  ...stackProps,
  config,
});

// ---------------------------------------------------------------------------
// 2. Security Stack — KMS CMK, Cognito User Pool, WAF WebACL
// ---------------------------------------------------------------------------
const securityStack = new SecurityStack(app, `${config.prefix}-security`, {
  ...stackProps,
  config,
});

// ---------------------------------------------------------------------------
// 3. Storage Stack — S3 buckets (files, thumbnails, frontend, access logs)
// ---------------------------------------------------------------------------
const storageStack = new StorageStack(app, `${config.prefix}-storage`, {
  ...stackProps,
  config,
  kmsKeyArn: securityStack.masterKey.keyArn,
});
storageStack.addDependency(securityStack);

// ---------------------------------------------------------------------------
// 4. Database Stack — DynamoDB, RDS PostgreSQL, ElastiCache Redis
// ---------------------------------------------------------------------------
const databaseStack = new DatabaseStack(app, `${config.prefix}-database`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  rdsSecurityGroup: networkStack.rdsSecurityGroup,
  redisSecurityGroup: networkStack.redisSecurityGroup,
});
databaseStack.addDependency(networkStack);

// ---------------------------------------------------------------------------
// 5. Messaging Stack — SQS queues, SNS topics, EventBridge bus + rules
// ---------------------------------------------------------------------------
const messagingStack = new MessagingStack(app, `${config.prefix}-messaging`, {
  ...stackProps,
  config,
  filesBucketName: storageStack.filesBucket.bucketName,
});
messagingStack.addDependency(storageStack);

// ---------------------------------------------------------------------------
// 6. Compute Stack — Lambda functions, API Gateway
// ---------------------------------------------------------------------------
const computeStack = new ComputeStack(app, `${config.prefix}-compute`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  lambdaSecurityGroup: networkStack.lambdaSecurityGroup,
  metadataTable: databaseStack.metadataTable,
  filesBucket: storageStack.filesBucket,
  thumbnailsBucket: storageStack.thumbnailsBucket,
  masterKey: securityStack.masterKey,
  userPool: securityStack.userPool,
  thumbnailQueue: messagingStack.thumbnailQueue,
  virusScanQueue: messagingStack.virusScanQueue,
});
computeStack.addDependency(networkStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(storageStack);
computeStack.addDependency(securityStack);
computeStack.addDependency(messagingStack);

// ---------------------------------------------------------------------------
// 7. CDN Stack — CloudFront distributions for frontend and thumbnails
//    Note: Uses bucket names (not constructs) to avoid circular dependency
//    between StorageStack and CdnStack OAC policies.
// ---------------------------------------------------------------------------
const cdnStack = new CdnStack(app, `${config.prefix}-cdn`, {
  ...stackProps,
  config,
  frontendBucket: storageStack.frontendBucket,
  thumbnailsBucket: storageStack.thumbnailsBucket,
  webAclArn: securityStack.webAcl?.attrArn,
});
// Note: CDK infers dependency on storageStack via bucket references automatically.
// Explicit addDependency would cause a cycle due to OAC policies.
cdnStack.addDependency(securityStack);

// ---------------------------------------------------------------------------
// 8. Monitoring Stack — CloudWatch alarms, CloudTrail, dashboards
// ---------------------------------------------------------------------------
const monitoringStack = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  ...stackProps,
  apiGatewayName: `${config.prefix}-api`,
  apiLambdaFunctionName: `${config.prefix}-api`,
  thumbnailDlqName: `${config.prefix}-thumbnail-dlq`,
  virusScanDlqName: `${config.prefix}-virus-scan-dlq`,
  rdsInstanceId: `${config.prefix}-audit-db`,
  redisClusterId: `${config.prefix}-redis`,
});
monitoringStack.addDependency(computeStack);
monitoringStack.addDependency(databaseStack);

app.synth();
