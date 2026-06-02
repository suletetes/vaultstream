/**
 * Environment-specific configuration for VaultStream CDK stacks.
 *
 * Centralizes all environment-varying parameters so stack code
 * remains environment-agnostic.
 */

export type EnvironmentName = 'dev' | 'prod';

export interface NetworkConfig {
  /** Number of NAT Gateways (1 for dev, 2 for prod) */
  natGateways: number;
  /** VPC CIDR block */
  vpcCidr: string;
}

export interface DatabaseConfig {
  /** RDS instance class */
  rdsInstanceClass: string;
  /** Whether RDS Multi-AZ is enabled */
  rdsMultiAz: boolean;
  /** Number of RDS read replicas */
  rdsReadReplicas: number;
  /** RDS backup retention in days */
  rdsBackupRetentionDays: number;
  /** ElastiCache node type */
  redisNodeType: string;
  /** Number of Redis replicas */
  redisReplicas: number;
}

export interface ComputeConfig {
  /** API Lambda memory in MB */
  apiLambdaMemory: number;
  /** API Lambda timeout in seconds */
  apiLambdaTimeout: number;
  /** API Lambda provisioned concurrency */
  apiProvisionedConcurrency: number;
  /** Thumbnail Lambda memory in MB */
  thumbnailLambdaMemory: number;
  /** Thumbnail Lambda timeout in seconds */
  thumbnailLambdaTimeout: number;
  /** Virus Scanner Lambda memory in MB */
  virusScanLambdaMemory: number;
  /** Virus Scanner Lambda timeout in seconds */
  virusScanLambdaTimeout: number;
  /** Lifecycle Lambda memory in MB */
  lifecycleLambdaMemory: number;
  /** Lifecycle Lambda timeout in seconds */
  lifecycleLambdaTimeout: number;
  /** Post-Signup Lambda memory in MB */
  postSignupLambdaMemory: number;
  /** Post-Signup Lambda timeout in seconds */
  postSignupLambdaTimeout: number;
}

export interface SecurityConfig {
  /** Whether WAF is enabled */
  wafEnabled: boolean;
  /** WAF rate limit (requests per 5 minutes) */
  wafRateLimit: number;
  /** Whether KMS key rotation is enabled */
  kmsKeyRotation: boolean;
}

export interface MonitoringConfig {
  /** Whether detailed CloudWatch alarms are enabled */
  alarmsEnabled: boolean;
  /** Whether X-Ray tracing is enabled */
  xrayEnabled: boolean;
  /** Log retention in days */
  logRetentionDays: number;
}

export interface EnvironmentConfig {
  /** Environment name */
  envName: EnvironmentName;
  /** AWS account ID */
  account: string;
  /** AWS region */
  region: string;
  /** Resource name prefix */
  prefix: string;
  /** Network configuration */
  network: NetworkConfig;
  /** Database configuration */
  database: DatabaseConfig;
  /** Compute configuration */
  compute: ComputeConfig;
  /** Security configuration */
  security: SecurityConfig;
  /** Monitoring configuration */
  monitoring: MonitoringConfig;
  /** Whether deletion protection is enabled on stateful resources */
  deletionProtection: boolean;
  /** Whether to enable point-in-time recovery for DynamoDB */
  pitrEnabled: boolean;
}

/**
 * Development environment configuration.
 * Optimized for cost with minimal redundancy.
 */
export const devConfig: EnvironmentConfig = {
  envName: 'dev',
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '',
  region: 'us-east-1',
  prefix: 'vaultstream-dev',
  network: {
    natGateways: 1,
    vpcCidr: '10.0.0.0/16',
  },
  database: {
    rdsInstanceClass: 'db.t3.micro',
    rdsMultiAz: false,
    rdsReadReplicas: 0,
    rdsBackupRetentionDays: 7,
    redisNodeType: 'cache.t3.micro',
    redisReplicas: 0,
  },
  compute: {
    apiLambdaMemory: 512,
    apiLambdaTimeout: 30,
    apiProvisionedConcurrency: 0,
    thumbnailLambdaMemory: 1024,
    thumbnailLambdaTimeout: 60,
    virusScanLambdaMemory: 2048,
    virusScanLambdaTimeout: 300,
    lifecycleLambdaMemory: 256,
    lifecycleLambdaTimeout: 30,
    postSignupLambdaMemory: 128,
    postSignupLambdaTimeout: 5,
  },
  security: {
    wafEnabled: false,
    wafRateLimit: 1000,
    kmsKeyRotation: true,
  },
  monitoring: {
    alarmsEnabled: false,
    xrayEnabled: false,
    logRetentionDays: 7,
  },
  deletionProtection: false,
  pitrEnabled: false,
};

/**
 * Production environment configuration.
 * Optimized for reliability with full redundancy.
 */
export const prodConfig: EnvironmentConfig = {
  envName: 'prod',
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '',
  region: 'us-east-1',
  prefix: 'vaultstream-prod',
  network: {
    natGateways: 2,
    vpcCidr: '10.0.0.0/16',
  },
  database: {
    rdsInstanceClass: 'db.t3.medium',
    rdsMultiAz: true,
    rdsReadReplicas: 1,
    rdsBackupRetentionDays: 7,
    redisNodeType: 'cache.t3.micro',
    redisReplicas: 1,
  },
  compute: {
    apiLambdaMemory: 512,
    apiLambdaTimeout: 30,
    apiProvisionedConcurrency: 2,
    thumbnailLambdaMemory: 1024,
    thumbnailLambdaTimeout: 60,
    virusScanLambdaMemory: 2048,
    virusScanLambdaTimeout: 300,
    lifecycleLambdaMemory: 256,
    lifecycleLambdaTimeout: 30,
    postSignupLambdaMemory: 128,
    postSignupLambdaTimeout: 5,
  },
  security: {
    wafEnabled: true,
    wafRateLimit: 1000,
    kmsKeyRotation: true,
  },
  monitoring: {
    alarmsEnabled: true,
    xrayEnabled: true,
    logRetentionDays: 90,
  },
  deletionProtection: true,
  pitrEnabled: true,
};

/**
 * Resolve environment config by name.
 */
export function getEnvironmentConfig(envName: EnvironmentName): EnvironmentConfig {
  switch (envName) {
    case 'dev':
      return devConfig;
    case 'prod':
      return prodConfig;
    default:
      throw new Error(`Unknown environment: ${envName as string}`);
  }
}
