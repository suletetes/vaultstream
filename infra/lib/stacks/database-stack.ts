import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the DatabaseStack.
 */
export interface DatabaseStackProps extends cdk.StackProps {
  /** Environment configuration */
  config: EnvironmentConfig;
  /** VPC for RDS and ElastiCache placement */
  vpc: ec2.IVpc;
  /** Security group for RDS access */
  rdsSecurityGroup: ec2.ISecurityGroup;
  /** Security group for Redis access */
  redisSecurityGroup: ec2.ISecurityGroup;
}

/**
 * Database stack for VaultStream.
 *
 * Provisions:
 * - DynamoDB single-table (PAY_PER_REQUEST, PITR, TTL, 3 GSIs)
 * - RDS PostgreSQL 16 (encrypted, Performance Insights, Multi-AZ in prod)
 * - ElastiCache Redis 7.x (TLS, AUTH token, daily snapshots)
 */
export class DatabaseStack extends cdk.Stack {
  /** DynamoDB metadata table */
  public readonly metadataTable: dynamodb.Table;
  /** RDS PostgreSQL primary instance */
  public readonly auditDbInstance: rds.DatabaseInstance;
  /** RDS read replica (prod only) */
  public readonly auditDbReadReplica?: rds.DatabaseInstanceReadReplica;
  /** ElastiCache Redis replication group */
  public readonly redisCluster: elasticache.CfnReplicationGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, rdsSecurityGroup, redisSecurityGroup } = props;

    // =========================================================================
    // DynamoDB Single-Table: vaultstream-metadata
    // =========================================================================
    this.metadataTable = new dynamodb.Table(this, 'MetadataTable', {
      tableName: `${config.prefix}-metadata`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pitrEnabled,
      },
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: Recently accessed files, Admin user listing
    this.metadataTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Folder contents
    this.metadataTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Shared-with-me
    this.metadataTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // =========================================================================
    // RDS PostgreSQL 16 — Audit Log Database
    // =========================================================================

    // KMS key for RDS encryption
    const rdsEncryptionKey = new kms.Key(this, 'RdsEncryptionKey', {
      alias: `${config.prefix}-rds-key`,
      description: 'Encryption key for VaultStream RDS audit database',
      enableKeyRotation: true,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // RDS credentials stored in Secrets Manager
    const dbCredentials = rds.Credentials.fromGeneratedSecret('vaultstream_admin', {
      secretName: `${config.prefix}/rds/credentials`,
    });

    // Subnet group for RDS (private subnets)
    const rdsSubnetGroup = new rds.SubnetGroup(this, 'RdsSubnetGroup', {
      description: 'Subnet group for VaultStream RDS instances',
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // RDS PostgreSQL primary instance
    this.auditDbInstance = new rds.DatabaseInstance(this, 'AuditDbInstance', {
      instanceIdentifier: `${config.prefix}-audit-db`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: new ec2.InstanceType(config.database.rdsInstanceClass.replace('db.', '')),
      vpc,
      subnetGroup: rdsSubnetGroup,
      securityGroups: [rdsSecurityGroup],
      credentials: dbCredentials,
      databaseName: 'vaultstream_audit',
      multiAz: config.database.rdsMultiAz,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      storageEncryptionKey: rdsEncryptionKey,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: rdsEncryptionKey,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      backupRetention: cdk.Duration.days(config.database.rdsBackupRetentionDays),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      deletionProtection: config.deletionProtection,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
    });

    // Read replica (prod only)
    if (config.database.rdsReadReplicas > 0) {
      this.auditDbReadReplica = new rds.DatabaseInstanceReadReplica(
        this,
        'AuditDbReadReplica',
        {
          instanceIdentifier: `${config.prefix}-audit-db-replica`,
          sourceDatabaseInstance: this.auditDbInstance,
          instanceType: new ec2.InstanceType(config.database.rdsInstanceClass.replace('db.', '')),
          vpc,
          securityGroups: [rdsSecurityGroup],
          storageEncrypted: true,
          storageEncryptionKey: rdsEncryptionKey,
          enablePerformanceInsights: true,
          performanceInsightEncryptionKey: rdsEncryptionKey,
          publiclyAccessible: false,
          autoMinorVersionUpgrade: true,
          removalPolicy: config.deletionProtection
            ? cdk.RemovalPolicy.RETAIN
            : cdk.RemovalPolicy.DESTROY,
        },
      );
    }

    // =========================================================================
    // ElastiCache Redis 7.x — Cache & Sessions
    // =========================================================================

    // Redis AUTH token stored in Secrets Manager
    const redisAuthToken = new secretsmanager.Secret(this, 'RedisAuthToken', {
      secretName: `${config.prefix}/redis/auth-token`,
      description: 'AUTH token for VaultStream Redis cluster',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Subnet group for ElastiCache (private subnets)
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for VaultStream Redis cluster',
      cacheSubnetGroupName: `${config.prefix}-redis-subnet-group`,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });

    // ElastiCache Redis replication group
    this.redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
      replicationGroupDescription: 'VaultStream Redis cache cluster',
      replicationGroupId: `${config.prefix}-redis`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: config.database.redisNodeType,
      numCacheClusters: 1 + config.database.redisReplicas,
      automaticFailoverEnabled: config.database.redisReplicas > 0,
      multiAzEnabled: config.database.redisReplicas > 0,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      authToken: cdk.Token.asString(redisAuthToken.secretValue),
      port: 6379,
      snapshotRetentionLimit: 1,
      snapshotWindow: '05:00-06:00',
      preferredMaintenanceWindow: 'sun:06:00-sun:07:00',
      autoMinorVersionUpgrade: true,
    });

    this.redisCluster.addDependency(redisSubnetGroup);

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'MetadataTableName', {
      value: this.metadataTable.tableName,
      description: 'DynamoDB metadata table name',
    });

    new cdk.CfnOutput(this, 'MetadataTableArn', {
      value: this.metadataTable.tableArn,
      description: 'DynamoDB metadata table ARN',
    });

    new cdk.CfnOutput(this, 'AuditDbEndpoint', {
      value: this.auditDbInstance.dbInstanceEndpointAddress,
      description: 'RDS audit database endpoint',
    });

    new cdk.CfnOutput(this, 'AuditDbSecretArn', {
      value: this.auditDbInstance.secret?.secretArn ?? '',
      description: 'RDS credentials secret ARN',
    });

    new cdk.CfnOutput(this, 'RedisAuthTokenArn', {
      value: redisAuthToken.secretArn,
      description: 'Redis AUTH token secret ARN',
    });
  }
}
