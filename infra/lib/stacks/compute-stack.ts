import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the ComputeStack.
 */
export interface ComputeStackProps extends cdk.StackProps {
  /** Environment configuration */
  config: EnvironmentConfig;
  /** VPC for Lambda placement */
  vpc: ec2.IVpc;
  /** Security group for Lambda functions */
  lambdaSecurityGroup: ec2.ISecurityGroup;
  /** DynamoDB metadata table */
  metadataTable: dynamodb.ITable;
  /** Primary encrypted file storage bucket */
  filesBucket: s3.IBucket;
  /** Thumbnail storage bucket */
  thumbnailsBucket: s3.IBucket;
  /** KMS master key for envelope encryption */
  masterKey: kms.IKey;
  /** Cognito User Pool for API Gateway authorizer */
  userPool: cognito.IUserPool;
  /** SQS thumbnail processing queue */
  thumbnailQueue?: sqs.IQueue;
  /** SQS virus scan processing queue */
  virusScanQueue?: sqs.IQueue;
}

/**
 * Placeholder inline handler code for Lambda functions.
 * Actual code is deployed separately via CI/CD pipeline with esbuild bundling.
 */
const PLACEHOLDER_HANDLER = `exports.handler = async (event) => {
  console.log('Placeholder handler', JSON.stringify(event));
  return { statusCode: 200, body: JSON.stringify({ message: 'placeholder' }) };
};`;

/**
 * VaultStream Compute Stack
 *
 * Provisions:
 * - API Lambda (Express via @vendia/serverless-express, 512MB, 30s, VPC, provisioned concurrency in prod)
 * - Thumbnail Lambda (Sharp/WebP processing, 1024MB, 60s)
 * - Virus Scanner Lambda (ClamAV, 2048MB, 300s)
 * - Lifecycle Lambda (S3 storage class transition metadata updates, 256MB, 30s)
 * - Post-Signup Lambda (Cognito PostConfirmation trigger, 128MB, 5s)
 * - API Gateway REST API with Cognito authorizer and 1000 RPS throttle
 *
 * All Lambdas use Node.js 20 runtime, are VPC-attached using the Lambda security group
 * from NetworkStack, and use placeholder inline code (actual code deployed separately
 * with esbuild bundling: tree-shaking, minify, external @aws-sdk/*).
 *
 * Requirements: 28.4, 34.6, 34.7, 12.8
 */
export class ComputeStack extends cdk.Stack {
  /** API Lambda function */
  public readonly apiLambda: lambda.Function;
  /** Thumbnail processing Lambda function */
  public readonly thumbnailLambda: lambda.Function;
  /** Virus scanner Lambda function */
  public readonly virusScanLambda: lambda.Function;
  /** Lifecycle processor Lambda function */
  public readonly lifecycleLambda: lambda.Function;
  /** Post-signup Lambda function */
  public readonly postSignupLambda: lambda.Function;
  /** API Gateway REST API */
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      config,
      vpc,
      lambdaSecurityGroup,
      metadataTable,
      filesBucket,
      thumbnailsBucket,
      masterKey,
      userPool,
      thumbnailQueue,
      virusScanQueue,
    } = props;

    // Shared environment variables for all Lambda functions
    const sharedEnvironment: Record<string, string> = {
      NODE_ENV: config.envName === 'prod' ? 'production' : 'development',
      METADATA_TABLE_NAME: metadataTable.tableName,
      FILES_BUCKET_NAME: filesBucket.bucketName,
      THUMBNAILS_BUCKET_NAME: thumbnailsBucket.bucketName,
      KMS_KEY_ID: masterKey.keyId,
      REGION: config.region,
    };

    // Shared VPC configuration for all Lambda functions
    const vpcConfig = {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
    };

    // =========================================================================
    // API Lambda — Express via @vendia/serverless-express
    // 512MB, 30s timeout, VPC-attached, provisioned concurrency in prod
    // =========================================================================
    this.apiLambda = new lambda.Function(this, 'ApiLambda', {
      functionName: `${config.prefix}-api`,
      description: 'VaultStream Express API handler via @vendia/serverless-express',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
      memorySize: config.compute.apiLambdaMemory,
      timeout: cdk.Duration.seconds(config.compute.apiLambdaTimeout),
      ...vpcConfig,
      environment: {
        ...sharedEnvironment,
        ...(thumbnailQueue ? { THUMBNAIL_QUEUE_URL: thumbnailQueue.queueUrl } : {}),
        ...(virusScanQueue ? { VIRUS_SCAN_QUEUE_URL: virusScanQueue.queueUrl } : {}),
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Provisioned concurrency for prod (warm starts)
    if (config.compute.apiProvisionedConcurrency > 0) {
      const version = this.apiLambda.currentVersion;
      new lambda.Alias(this, 'ApiLambdaAlias', {
        aliasName: 'live',
        version,
        provisionedConcurrentExecutions: config.compute.apiProvisionedConcurrency,
      });
    }

    // API Lambda IAM permissions — least privilege
    metadataTable.grantReadWriteData(this.apiLambda);
    filesBucket.grantReadWrite(this.apiLambda);
    thumbnailsBucket.grantRead(this.apiLambda);
    masterKey.grant(this.apiLambda, 'kms:GenerateDataKey', 'kms:Decrypt', 'kms:DescribeKey');
    if (thumbnailQueue) {
      thumbnailQueue.grantSendMessages(this.apiLambda);
    }
    if (virusScanQueue) {
      virusScanQueue.grantSendMessages(this.apiLambda);
    }

    // =========================================================================
    // Thumbnail Lambda — Sharp/WebP processing
    // 1024MB, 60s timeout, VPC-attached
    // =========================================================================
    this.thumbnailLambda = new lambda.Function(this, 'ThumbnailLambda', {
      functionName: `${config.prefix}-thumbnail`,
      description: 'Generates WebP thumbnails from uploaded images using Sharp',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
      memorySize: config.compute.thumbnailLambdaMemory,
      timeout: cdk.Duration.seconds(config.compute.thumbnailLambdaTimeout),
      ...vpcConfig,
      environment: {
        ...sharedEnvironment,
        HANDLER_TYPE: 'thumbnail',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Thumbnail Lambda IAM permissions
    filesBucket.grantRead(this.thumbnailLambda);
    thumbnailsBucket.grantReadWrite(this.thumbnailLambda);
    metadataTable.grantReadWriteData(this.thumbnailLambda);
    masterKey.grant(this.thumbnailLambda, 'kms:Decrypt');

    // =========================================================================
    // Virus Scanner Lambda — ClamAV scanning
    // 2048MB, 300s timeout, VPC-attached
    // =========================================================================
    this.virusScanLambda = new lambda.Function(this, 'VirusScanLambda', {
      functionName: `${config.prefix}-virus-scan`,
      description: 'Scans uploaded files for malware using ClamAV',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
      memorySize: config.compute.virusScanLambdaMemory,
      timeout: cdk.Duration.seconds(config.compute.virusScanLambdaTimeout),
      ...vpcConfig,
      environment: {
        ...sharedEnvironment,
        HANDLER_TYPE: 'virusScan',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Virus Scanner Lambda IAM permissions
    filesBucket.grantRead(this.virusScanLambda);
    metadataTable.grantReadWriteData(this.virusScanLambda);
    masterKey.grant(this.virusScanLambda, 'kms:Decrypt');

    // =========================================================================
    // Lifecycle Lambda — Storage class transition metadata updates
    // 256MB, 30s timeout, VPC-attached
    // =========================================================================
    this.lifecycleLambda = new lambda.Function(this, 'LifecycleLambda', {
      functionName: `${config.prefix}-lifecycle`,
      description: 'Processes S3 lifecycle transitions and updates DynamoDB metadata',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
      memorySize: config.compute.lifecycleLambdaMemory,
      timeout: cdk.Duration.seconds(config.compute.lifecycleLambdaTimeout),
      ...vpcConfig,
      environment: {
        ...sharedEnvironment,
        HANDLER_TYPE: 'lifecycle',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Lifecycle Lambda IAM permissions
    metadataTable.grantReadWriteData(this.lifecycleLambda);
    filesBucket.grantRead(this.lifecycleLambda);

    // =========================================================================
    // Post-Signup Lambda — Cognito PostConfirmation trigger
    // 128MB, 5s timeout, VPC-attached
    // =========================================================================
    this.postSignupLambda = new lambda.Function(this, 'PostSignupLambda', {
      functionName: `${config.prefix}-post-signup`,
      description: 'Creates user profile in DynamoDB with free-tier quota on signup',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(PLACEHOLDER_HANDLER),
      memorySize: config.compute.postSignupLambdaMemory,
      timeout: cdk.Duration.seconds(config.compute.postSignupLambdaTimeout),
      ...vpcConfig,
      environment: {
        ...sharedEnvironment,
        HANDLER_TYPE: 'postSignup',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Post-Signup Lambda IAM permissions
    metadataTable.grantReadWriteData(this.postSignupLambda);

    // =========================================================================
    // API Gateway REST API — Cognito authorizer, 1000 RPS throttle
    // Requirement 12.8
    // =========================================================================
    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `${config.prefix}-api`,
      description: 'VaultStream REST API with Cognito authorization',
      deployOptions: {
        stageName: config.envName,
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 500,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.envName !== 'prod',
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://app.vaultstream.dev', 'http://localhost:3000'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Request-Id',
          'X-Amz-Date',
          'X-Api-Key',
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Cognito User Pool Authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `${config.prefix}-cognito-authorizer`,
        identitySource: 'method.request.header.Authorization',
      },
    );

    // Proxy integration with API Lambda
    const apiIntegration = new apigateway.LambdaIntegration(this.apiLambda, {
      proxy: true,
    });

    // Root proxy resource — routes all requests to Express
    this.restApi.root.addProxy({
      defaultIntegration: apiIntegration,
      defaultMethodOptions: {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      },
      anyMethod: true,
    });

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'ApiLambdaArn', {
      value: this.apiLambda.functionArn,
      description: 'API Lambda function ARN',
      exportName: `${config.prefix}-api-lambda-arn`,
    });

    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: this.restApi.url,
      description: 'API Gateway REST API URL',
      exportName: `${config.prefix}-rest-api-url`,
    });

    new cdk.CfnOutput(this, 'RestApiId', {
      value: this.restApi.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `${config.prefix}-rest-api-id`,
    });
  }
}
