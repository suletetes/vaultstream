import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the NetworkStack, extending standard StackProps with
 * the environment-specific configuration.
 */
export interface NetworkStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * VPC and Network stack for VaultStream.
 *
 * Creates:
 * - VPC with 10.0.0.0/16 CIDR, public/private subnets across 2 AZs
 * - NAT Gateways (1 for dev, 2 for prod)
 * - S3 and DynamoDB Gateway VPC Endpoints (free)
 * - KMS and SQS Interface VPC Endpoints
 * - Security groups for Lambda, Redis, and RDS with least-privilege rules
 *
 * Requirements: 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7
 */
export class NetworkStack extends cdk.Stack {
  /** The VPC containing all private resources */
  public readonly vpc: ec2.Vpc;

  /** Security group for Lambda functions (outbound to Redis, RDS, HTTPS) */
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  /** Security group for ElastiCache Redis (inbound from Lambda SG on 6379) */
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  /** Security group for RDS PostgreSQL (inbound from Lambda SG on 5432) */
  public readonly rdsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -------------------------------------------------------------------------
    // VPC — 10.0.0.0/16 with public and private subnets across 2 AZs
    // Requirement 29.1, 29.2
    // -------------------------------------------------------------------------
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${config.prefix}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(config.network.vpcCidr),
      maxAzs: 2,
      natGateways: config.network.natGateways,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // -------------------------------------------------------------------------
    // Gateway VPC Endpoints — S3 and DynamoDB (free, no NAT traversal)
    // Requirement 29.3
    // -------------------------------------------------------------------------
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    // -------------------------------------------------------------------------
    // Interface VPC Endpoints — KMS and SQS (reduced latency for encryption/messaging)
    // Requirement 29.4
    // -------------------------------------------------------------------------
    this.vpc.addInterfaceEndpoint('KmsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint('SqsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      privateDnsEnabled: true,
    });

    // -------------------------------------------------------------------------
    // Security Groups — Least-privilege network access
    // Requirements 29.5, 29.6
    // -------------------------------------------------------------------------

    // Lambda Security Group
    // Outbound: Redis (6379), RDS (5432), HTTPS (443)
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      securityGroupName: `${config.prefix}-lambda-sg`,
      description: 'Security group for Lambda functions in private subnets',
      allowAllOutbound: false,
    });

    // Redis Security Group
    // Inbound: Lambda SG on port 6379
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      securityGroupName: `${config.prefix}-redis-sg`,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: false,
    });

    // RDS Security Group
    // Inbound: Lambda SG on port 5432
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      securityGroupName: `${config.prefix}-rds-sg`,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });

    // --- Lambda outbound rules ---
    // Allow Lambda to reach Redis on port 6379
    this.lambdaSecurityGroup.addEgressRule(
      this.redisSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda to connect to Redis',
    );

    // Allow Lambda to reach RDS on port 5432
    this.lambdaSecurityGroup.addEgressRule(
      this.rdsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to RDS PostgreSQL',
    );

    // Allow Lambda outbound HTTPS (443) for AWS service calls via VPC endpoints and NAT
    this.lambdaSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow Lambda outbound HTTPS for AWS services',
    );

    // --- Redis inbound rules ---
    // Accept connections from Lambda SG on port 6379
    this.redisSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow inbound from Lambda to Redis',
    );

    // --- RDS inbound rules ---
    // Accept connections from Lambda SG on port 5432
    this.rdsSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow inbound from Lambda to RDS PostgreSQL',
    );
  }
}
