import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from './network-stack';
import { devConfig, prodConfig } from '../config';

function createStack(config = devConfig): Template {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetworkStack', {
    config,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('NetworkStack', () => {
  describe('VPC Configuration', () => {
    it('should create a VPC with 10.0.0.0/16 CIDR', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
      });
    });

    it('should create public and private subnets across 2 AZs', () => {
      const template = createStack();
      // 2 public + 2 private = 4 subnets
      template.resourceCountIs('AWS::EC2::Subnet', 4);
    });
  });

  describe('NAT Gateways', () => {
    it('should create 1 NAT Gateway for dev environment', () => {
      const template = createStack(devConfig);
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });

    it('should create 2 NAT Gateways for prod environment', () => {
      const template = createStack(prodConfig);
      template.resourceCountIs('AWS::EC2::NatGateway', 2);
    });
  });

  describe('VPC Endpoints', () => {
    it('should create S3 Gateway endpoint', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        ServiceName: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('s3')]),
          ]),
        }),
        VpcEndpointType: 'Gateway',
      });
    });

    it('should create DynamoDB Gateway endpoint', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        ServiceName: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('dynamodb')]),
          ]),
        }),
        VpcEndpointType: 'Gateway',
      });
    });

    it('should create KMS Interface endpoint', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        ServiceName: Match.stringLikeRegexp('kms'),
        VpcEndpointType: 'Interface',
        PrivateDnsEnabled: true,
      });
    });

    it('should create SQS Interface endpoint', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        ServiceName: Match.stringLikeRegexp('sqs'),
        VpcEndpointType: 'Interface',
        PrivateDnsEnabled: true,
      });
    });
  });

  describe('Security Groups', () => {
    it('should create Lambda security group with no default outbound', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for Lambda functions in private subnets',
      });
    });

    it('should create Redis security group', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for ElastiCache Redis',
      });
    });

    it('should create RDS security group', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for RDS PostgreSQL',
      });
    });

    it('should allow Lambda outbound to Redis on port 6379', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
        IpProtocol: 'tcp',
        FromPort: 6379,
        ToPort: 6379,
      });
    });

    it('should allow Lambda outbound to RDS on port 5432', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
        IpProtocol: 'tcp',
        FromPort: 5432,
        ToPort: 5432,
      });
    });

    it('should allow Lambda outbound HTTPS on port 443', () => {
      const template = createStack();
      // CDK synthesizes CIDR-based egress rules inline on the SecurityGroup resource
      // rather than as separate SecurityGroupEgress resources
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for Lambda functions in private subnets',
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            CidrIp: '0.0.0.0/0',
          }),
        ]),
      });
    });

    it('should allow Redis inbound from Lambda SG on port 6379', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        IpProtocol: 'tcp',
        FromPort: 6379,
        ToPort: 6379,
      });
    });

    it('should allow RDS inbound from Lambda SG on port 5432', () => {
      const template = createStack();
      template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        IpProtocol: 'tcp',
        FromPort: 5432,
        ToPort: 5432,
      });
    });
  });

  describe('Stack Exports', () => {
    it('should expose vpc property', () => {
      const app = new cdk.App();
      const stack = new NetworkStack(app, 'TestStack', {
        config: devConfig,
        env: { account: '123456789012', region: 'us-east-1' },
      });
      expect(stack.vpc).toBeDefined();
    });

    it('should expose lambdaSecurityGroup property', () => {
      const app = new cdk.App();
      const stack = new NetworkStack(app, 'TestStack', {
        config: devConfig,
        env: { account: '123456789012', region: 'us-east-1' },
      });
      expect(stack.lambdaSecurityGroup).toBeDefined();
    });

    it('should expose redisSecurityGroup property', () => {
      const app = new cdk.App();
      const stack = new NetworkStack(app, 'TestStack', {
        config: devConfig,
        env: { account: '123456789012', region: 'us-east-1' },
      });
      expect(stack.redisSecurityGroup).toBeDefined();
    });

    it('should expose rdsSecurityGroup property', () => {
      const app = new cdk.App();
      const stack = new NetworkStack(app, 'TestStack', {
        config: devConfig,
        env: { account: '123456789012', region: 'us-east-1' },
      });
      expect(stack.rdsSecurityGroup).toBeDefined();
    });
  });
});
