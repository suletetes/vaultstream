import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from './database-stack';
import { devConfig, prodConfig } from '../config';

function createTestStack(config: typeof devConfig) {
  const app = new cdk.App();
  const vpcStack = new cdk.Stack(app, 'VpcStack');
  const vpc = new ec2.Vpc(vpcStack, 'Vpc', { maxAzs: 2 });
  const rdsSecurityGroup = new ec2.SecurityGroup(vpcStack, 'RdsSg', { vpc });
  const redisSecurityGroup = new ec2.SecurityGroup(vpcStack, 'RedisSg', { vpc });

  const stack = new DatabaseStack(app, 'DatabaseStack', {
    config,
    vpc,
    rdsSecurityGroup,
    redisSecurityGroup,
  });

  return { stack, template: Template.fromStack(stack) };
}

describe('DatabaseStack', () => {
  describe('DynamoDB Table', () => {
    it('should create a DynamoDB table with PAY_PER_REQUEST billing', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('should configure PK and SK as partition and sort keys', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      });
    });

    it('should configure TTL on expiresAt attribute', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'expiresAt',
          Enabled: true,
        },
      });
    });

    it('should disable PITR in dev', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: false,
        },
      });
    });

    it('should enable PITR in prod', () => {
      const { template } = createTestStack(prodConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it('should configure GSI1 with ALL projection', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });

    it('should configure GSI2 with ALL projection', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });

    it('should configure GSI3 with ALL projection', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'GSI3PK', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });
  });

  describe('RDS PostgreSQL', () => {
    it('should create a PostgreSQL 16 instance', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        Engine: 'postgres',
        EngineVersion: Match.stringLikeRegexp('^16'),
      });
    });

    it('should use db.t3.micro in dev', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t3.micro',
      });
    });

    it('should use db.t3.medium in prod', () => {
      const { template } = createTestStack(prodConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t3.medium',
      });
    });

    it('should disable Multi-AZ in dev', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        MultiAZ: false,
      });
    });

    it('should enable Multi-AZ in prod', () => {
      const { template } = createTestStack(prodConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        MultiAZ: true,
      });
    });

    it('should enable storage encryption', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        StorageEncrypted: true,
      });
    });

    it('should enable Performance Insights', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        EnablePerformanceInsights: true,
      });
    });

    it('should configure 7-day backup retention', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        BackupRetentionPeriod: 7,
      });
    });

    it('should not be publicly accessible', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        PubliclyAccessible: false,
      });
    });

    it('should create a read replica in prod', () => {
      const { template } = createTestStack(prodConfig);
      const dbInstances = template.findResources('AWS::RDS::DBInstance');
      const replicaCount = Object.values(dbInstances).filter(
        (instance: Record<string, unknown>) =>
          (instance as { Properties?: { SourceDBInstanceIdentifier?: unknown } }).Properties
            ?.SourceDBInstanceIdentifier !== undefined,
      ).length;
      expect(replicaCount).toBe(1);
    });

    it('should not create a read replica in dev', () => {
      const { stack } = createTestStack(devConfig);
      expect(stack.auditDbReadReplica).toBeUndefined();
    });
  });

  describe('ElastiCache Redis', () => {
    it('should create a Redis replication group', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        Engine: 'redis',
      });
    });

    it('should use Redis 7.x', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        EngineVersion: Match.stringLikeRegexp('^7'),
      });
    });

    it('should use cache.t3.micro node type', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        CacheNodeType: 'cache.t3.micro',
      });
    });

    it('should enable TLS (transit encryption)', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        TransitEncryptionEnabled: true,
      });
    });

    it('should enable at-rest encryption', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        AtRestEncryptionEnabled: true,
      });
    });

    it('should configure AUTH token', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        AuthToken: Match.anyValue(),
      });
    });

    it('should enable daily snapshots', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        SnapshotRetentionLimit: 1,
      });
    });

    it('should have 1 node in dev (no replicas)', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        NumCacheClusters: 1,
      });
    });

    it('should have 2 nodes in prod (1 replica)', () => {
      const { template } = createTestStack(prodConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        NumCacheClusters: 2,
      });
    });

    it('should enable automatic failover in prod', () => {
      const { template } = createTestStack(prodConfig);
      template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
        AutomaticFailoverEnabled: true,
      });
    });
  });

  describe('Secrets Manager', () => {
    it('should create a Redis AUTH token secret', () => {
      const { template } = createTestStack(devConfig);
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: 'AUTH token for VaultStream Redis cluster',
        GenerateSecretString: {
          ExcludePunctuation: true,
          PasswordLength: 64,
        },
      });
    });
  });

  describe('Stack exports', () => {
    it('should expose metadataTable', () => {
      const { stack } = createTestStack(devConfig);
      expect(stack.metadataTable).toBeDefined();
    });

    it('should expose auditDbInstance', () => {
      const { stack } = createTestStack(devConfig);
      expect(stack.auditDbInstance).toBeDefined();
    });

    it('should expose redisCluster', () => {
      const { stack } = createTestStack(devConfig);
      expect(stack.redisCluster).toBeDefined();
    });

    it('should expose auditDbReadReplica in prod', () => {
      const { stack } = createTestStack(prodConfig);
      expect(stack.auditDbReadReplica).toBeDefined();
    });
  });
});
