#!/usr/bin/env node
/**
 * VaultStream CDK Application Entry Point
 *
 * Instantiates all infrastructure stacks for the target environment.
 * Environment is selected via the CDK context value "env" (dev | prod).
 */

import * as cdk from 'aws-cdk-lib';
import { type EnvironmentName, getEnvironmentConfig } from '../lib/config';

const app = new cdk.App();

// Resolve target environment from CDK context (default: dev)
const envName = (app.node.tryGetContext('env') as EnvironmentName) ?? 'dev';
const config = getEnvironmentConfig(envName);

// AWS environment for stack deployment
const awsEnv: cdk.Environment = {
  account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

// Shared stack props — exported for use by stack implementations
export const stackProps: cdk.StackProps = {
  env: awsEnv,
  tags: {
    Project: 'VaultStream',
    Environment: config.envName,
    ManagedBy: 'CDK',
  },
};

// Re-export config for stack implementations to import
export { config };

// ---------------------------------------------------------------------------
// Stack instantiation
// Stacks are defined but not yet implemented — placeholder imports below.
// Each stack receives the shared config so it can adapt to the environment.
// ---------------------------------------------------------------------------

// NOTE: Uncomment as stacks are implemented in subsequent tasks.

// import { NetworkStack } from '../lib/stacks/network-stack';
// import { StorageStack } from '../lib/stacks/storage-stack';
// import { DatabaseStack } from '../lib/stacks/database-stack';
// import { SecurityStack } from '../lib/stacks/security-stack';
// import { ComputeStack } from '../lib/stacks/compute-stack';
// import { MessagingStack } from '../lib/stacks/messaging-stack';
// import { CdnStack } from '../lib/stacks/cdn-stack';
// import { MonitoringStack } from '../lib/stacks/monitoring-stack';

// const networkStack = new NetworkStack(app, `${config.prefix}-network`, {
//   ...stackProps,
//   config,
// });

// const storageStack = new StorageStack(app, `${config.prefix}-storage`, {
//   ...stackProps,
//   config,
// });

// const securityStack = new SecurityStack(app, `${config.prefix}-security`, {
//   ...stackProps,
//   config,
// });

// const databaseStack = new DatabaseStack(app, `${config.prefix}-database`, {
//   ...stackProps,
//   config,
//   vpc: networkStack.vpc,
// });

// const messagingStack = new MessagingStack(app, `${config.prefix}-messaging`, {
//   ...stackProps,
//   config,
// });

// const computeStack = new ComputeStack(app, `${config.prefix}-compute`, {
//   ...stackProps,
//   config,
//   vpc: networkStack.vpc,
// });

// const cdnStack = new CdnStack(app, `${config.prefix}-cdn`, {
//   ...stackProps,
//   config,
// });

// const monitoringStack = new MonitoringStack(app, `${config.prefix}-monitoring`, {
//   ...stackProps,
//   config,
// });

app.synth();
