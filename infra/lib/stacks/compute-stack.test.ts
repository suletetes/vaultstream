import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ComputeStack } from './compute-stack';
import { devConfig, prodConfig } from '../config';

/**
 * Helper to create a ComputeStack with all required dependencies.
 */
function createStack(config = devConfig): { template: Template; stack: ComputeStack } {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  // Create dependency stack with required resources
  const depStack = new cdk.Stack(app, 'DepStack', { env });

  const vpc = new ec2.Vpc(depStack, 'Vpc', { maxAzs: 2 });
  const lambdaSg = new ec2.SecurityGroup(depStack, 'LambdaSg', { vpc });
  const table = new dynamodb.Table(depStack, 'Table', {
    partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  });
  const filesBucket = new s3.Bucket(depStack, 'FilesBucket');
  const thumbnailsBucket = new s3.Bucket(depStack, 'ThumbnailsBucket');
  const masterKey = new kms.Key(depStack, 'MasterKey');
  const userPool = new cognito.UserPool(depStack, 'UserPool');
  const thumbnailQueue = new sqs.Queue(depStack, 'ThumbnailQueue');
  const virusScanQueue = new sqs.Queue(depStack, 'VirusScanQueue');

  const stack = new ComputeStack(app, 'TestComputeStack', {
    config,
    env,
    vpc,
    lambdaSecurityGroup: lambdaSg,
    metadataTable: table,
    filesBucket,
    thumbnailsBucket,
    masterKey,
    userPool,
    thumbnailQueue,
    virusScanQueue,
  });

  const template = Template.fromStack(stack);
  return { template, stack };
}

describe('ComputeStack', () => {
  describe('API Lambda', () => {
    it('should create API Lambda with Node.js 20 runtime', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-api',
        Runtime: 'nodejs20.x',
      });
    });

    it('should configure API Lambda with 512MB memory', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-api',
        MemorySize: 512,
      });
    });

    it('should configure API Lambda with 30s timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-api',
        Timeout: 30,
      });
    });

    it('should attach API Lambda to VPC', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-api',
        VpcConfig: Match.objectLike({
          SubnetIds: Match.anyValue(),
          SecurityGroupIds: Match.anyValue(),
        }),
      });
    });

    it('should NOT create provisioned concurrency for dev', () => {
      const { template } = createStack(devConfig);
      // No Alias resource should be created for dev (provisionedConcurrency = 0)
      const aliases = template.findResources('AWS::Lambda::Alias', {
        Properties: {
          Name: 'live',
        },
      });
      expect(Object.keys(aliases).length).toBe(0);
    });

    it('should create provisioned concurrency for prod', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::Lambda::Alias', {
        Name: 'live',
        ProvisionedConcurrencyConfig: {
          ProvisionedConcurrentExecutions: 2,
        },
      });
    });
  });

  describe('Thumbnail Lambda', () => {
    it('should create Thumbnail Lambda with 1024MB memory', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-thumbnail',
        MemorySize: 1024,
      });
    });

    it('should configure Thumbnail Lambda with 60s timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-thumbnail',
        Timeout: 60,
      });
    });

    it('should attach Thumbnail Lambda to VPC', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-thumbnail',
        VpcConfig: Match.objectLike({
          SubnetIds: Match.anyValue(),
          SecurityGroupIds: Match.anyValue(),
        }),
      });
    });
  });

  describe('Virus Scanner Lambda', () => {
    it('should create Virus Scanner Lambda with 2048MB memory', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-virus-scan',
        MemorySize: 2048,
      });
    });

    it('should configure Virus Scanner Lambda with 300s timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-virus-scan',
        Timeout: 300,
      });
    });

    it('should attach Virus Scanner Lambda to VPC', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-virus-scan',
        VpcConfig: Match.objectLike({
          SubnetIds: Match.anyValue(),
          SecurityGroupIds: Match.anyValue(),
        }),
      });
    });
  });

  describe('Lifecycle Lambda', () => {
    it('should create Lifecycle Lambda with 256MB memory', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-lifecycle',
        MemorySize: 256,
      });
    });

    it('should configure Lifecycle Lambda with 30s timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-lifecycle',
        Timeout: 30,
      });
    });

    it('should attach Lifecycle Lambda to VPC', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-lifecycle',
        VpcConfig: Match.objectLike({
          SubnetIds: Match.anyValue(),
          SecurityGroupIds: Match.anyValue(),
        }),
      });
    });
  });

  describe('Post-Signup Lambda', () => {
    it('should create Post-Signup Lambda with 128MB memory', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-post-signup',
        MemorySize: 128,
      });
    });

    it('should configure Post-Signup Lambda with 5s timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-post-signup',
        Timeout: 5,
      });
    });

    it('should attach Post-Signup Lambda to VPC', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'vaultstream-dev-post-signup',
        VpcConfig: Match.objectLike({
          SubnetIds: Match.anyValue(),
          SecurityGroupIds: Match.anyValue(),
        }),
      });
    });
  });

  describe('API Gateway', () => {
    it('should create REST API', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'vaultstream-dev-api',
      });
    });

    it('should configure throttling at 1000 RPS', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            ThrottlingRateLimit: 1000,
            ThrottlingBurstLimit: 500,
          }),
        ]),
      });
    });

    it('should create Cognito User Pool authorizer', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
        Name: 'vaultstream-dev-cognito-authorizer',
      });
    });

    it('should configure proxy integration', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        AuthorizationType: 'COGNITO_USER_POOLS',
        Integration: Match.objectLike({
          Type: 'AWS_PROXY',
        }),
      });
    });

    it('should configure CORS preflight', () => {
      const { template } = createStack();
      // OPTIONS method should exist for CORS
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        AuthorizationType: 'NONE',
      });
    });
  });

  describe('IAM Permissions', () => {
    it('should grant API Lambda DynamoDB read/write access', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:BatchGetItem',
                'dynamodb:Query',
              ]),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    it('should grant API Lambda KMS permissions', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['kms:GenerateDataKey']),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });
  });

  describe('Stack Exports', () => {
    it('should expose apiLambda property', () => {
      const { stack } = createStack();
      expect(stack.apiLambda).toBeDefined();
    });

    it('should expose thumbnailLambda property', () => {
      const { stack } = createStack();
      expect(stack.thumbnailLambda).toBeDefined();
    });

    it('should expose virusScanLambda property', () => {
      const { stack } = createStack();
      expect(stack.virusScanLambda).toBeDefined();
    });

    it('should expose lifecycleLambda property', () => {
      const { stack } = createStack();
      expect(stack.lifecycleLambda).toBeDefined();
    });

    it('should expose restApi property', () => {
      const { stack } = createStack();
      expect(stack.restApi).toBeDefined();
    });

    it('should create API Lambda ARN output', () => {
      const { template } = createStack();
      template.hasOutput('ApiLambdaArn', {
        Export: { Name: 'vaultstream-dev-api-lambda-arn' },
      });
    });

    it('should create REST API URL output', () => {
      const { template } = createStack();
      template.hasOutput('RestApiUrl', {
        Export: { Name: 'vaultstream-dev-rest-api-url' },
      });
    });
  });

  describe('All Lambdas use Node.js 20', () => {
    it('should use nodejs20.x runtime for all Lambda functions', () => {
      const { template } = createStack();
      const lambdas = template.findResources('AWS::Lambda::Function');
      const lambdaEntries = Object.values(lambdas);
      // Filter to only our named functions (exclude CDK framework functions)
      const namedLambdas = lambdaEntries.filter(
        (l: Record<string, unknown>) =>
          (l as { Properties?: { FunctionName?: string } }).Properties?.FunctionName?.startsWith('vaultstream-dev-'),
      );
      expect(namedLambdas.length).toBeGreaterThanOrEqual(5);
      for (const l of namedLambdas) {
        expect((l as { Properties?: { Runtime?: string } }).Properties?.Runtime).toBe('nodejs20.x');
      }
    });
  });
});
