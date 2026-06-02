import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the SecurityStack.
 */
export interface SecurityStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * VaultStream Security Stack
 *
 * Provisions:
 * - KMS Customer Managed Key (CMK) for envelope encryption
 * - Cognito User Pool with email/password auth, optional MFA, and PostConfirmation trigger
 * - Cognito App Client (public, PKCE, token expiry configuration)
 * - WAF WebACL with rate limiting, SQL injection, XSS, bot control, and geo-block rules
 */
export class SecurityStack extends cdk.Stack {
  /** KMS Customer Managed Key for envelope encryption */
  public readonly masterKey: kms.Key;

  /** Cognito User Pool */
  public readonly userPool: cognito.UserPool;

  /** Cognito App Client (public, PKCE) */
  public readonly appClient: cognito.UserPoolClient;

  /** WAF WebACL (only created if WAF is enabled) */
  public readonly webAcl?: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    const { config } = props;

    // =========================================================================
    // KMS Customer Managed Key (CMK)
    // =========================================================================
    this.masterKey = new kms.Key(this, 'MasterKey', {
      alias: `${config.prefix}-master-key`,
      description: 'VaultStream master CMK for envelope encryption (AES-256)',
      enableKeyRotation: config.security.kmsKeyRotation,
      rotationPeriod: cdk.Duration.days(365),
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(30),
    });

    // Key policy: Admin role — full key management
    this.masterKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAdminFullKeyManagement',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountRootPrincipal()],
        actions: ['kms:*'],
        resources: ['*'],
      }),
    );

    // Key policy: API Lambda role — GenerateDataKey, Decrypt, DescribeKey
    const apiLambdaRolePrincipal = new iam.ArnPrincipal(
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/${config.prefix}-api-lambda-role`,
    );
    this.masterKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAPILambdaKeyUsage',
        effect: iam.Effect.ALLOW,
        principals: [apiLambdaRolePrincipal],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt', 'kms:DescribeKey'],
        resources: ['*'],
      }),
    );

    // Key policy: S3 service — GenerateDataKey, Decrypt (via kms:ViaService condition)
    this.masterKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowS3ServiceKeyUsage',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `s3.${config.region}.amazonaws.com`,
          },
        },
      }),
    );

    // =========================================================================
    // Cognito User Pool
    // =========================================================================

    // PostConfirmation Lambda (placeholder — actual code deployed in compute stack)
    const postConfirmationLambda = new lambda.Function(
      this,
      'PostConfirmationLambda',
      {
        functionName: `${config.prefix}-post-confirmation`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(
          `exports.handler = async (event) => { console.log('PostConfirmation trigger', JSON.stringify(event)); return event; };`,
        ),
        memorySize: config.compute.postSignupLambdaMemory,
        timeout: cdk.Duration.seconds(config.compute.postSignupLambdaTimeout),
        description:
          'PostConfirmation trigger: creates user profile in DynamoDB with free-tier quota',
      },
    );

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.prefix}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      lambdaTriggers: {
        postConfirmation: postConfirmationLambda,
      },
      removalPolicy: config.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // Cognito App Client (public, PKCE)
    // =========================================================================
    this.appClient = this.userPool.addClient('AppClient', {
      userPoolClientName: `${config.prefix}-app-client`,
      generateSecret: false, // Public client — no secret
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          'https://app.vaultstream.dev/callback',
          'http://localhost:3000/callback',
        ],
        logoutUrls: [
          'https://app.vaultstream.dev',
          'http://localhost:3000',
        ],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // =========================================================================
    // WAF WebACL (conditional on config.security.wafEnabled)
    // =========================================================================
    if (config.security.wafEnabled) {
      this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
        name: `${config.prefix}-web-acl`,
        scope: 'CLOUDFRONT',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${config.prefix}-web-acl`,
          sampledRequestsEnabled: true,
        },
        rules: [
          // Rule 1: Rate limiting — 1000 requests per 5 minutes per IP
          {
            name: 'RateLimitPerIP',
            priority: 1,
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: config.security.wafRateLimit,
                aggregateKeyType: 'IP',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${config.prefix}-rate-limit`,
              sampledRequestsEnabled: true,
            },
          },
          // Rule 2: SQL Injection protection
          {
            name: 'SQLInjectionProtection',
            priority: 2,
            action: { block: {} },
            statement: {
              sqliMatchStatement: {
                fieldToMatch: { body: { oversizeHandling: 'CONTINUE' } },
                textTransformations: [
                  { priority: 0, type: 'URL_DECODE' },
                  { priority: 1, type: 'HTML_ENTITY_DECODE' },
                ],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${config.prefix}-sqli`,
              sampledRequestsEnabled: true,
            },
          },
          // Rule 3: XSS protection
          {
            name: 'XSSProtection',
            priority: 3,
            action: { block: {} },
            statement: {
              xssMatchStatement: {
                fieldToMatch: { body: { oversizeHandling: 'CONTINUE' } },
                textTransformations: [
                  { priority: 0, type: 'URL_DECODE' },
                  { priority: 1, type: 'HTML_ENTITY_DECODE' },
                ],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${config.prefix}-xss`,
              sampledRequestsEnabled: true,
            },
          },
          // Rule 4: Bot Control (AWS Managed Rules)
          {
            name: 'BotControl',
            priority: 4,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesBotControlRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${config.prefix}-bot-control`,
              sampledRequestsEnabled: true,
            },
          },
          // Rule 5: Geo-block sanctioned countries (KP, IR, CU, SY)
          {
            name: 'GeoBlockSanctionedCountries',
            priority: 5,
            action: { block: {} },
            statement: {
              geoMatchStatement: {
                countryCodes: ['KP', 'IR', 'CU', 'SY'],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${config.prefix}-geo-block`,
              sampledRequestsEnabled: true,
            },
          },
        ],
      });
    }

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.masterKey.keyArn,
      description: 'KMS Master Key ARN',
      exportName: `${config.prefix}-kms-key-arn`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${config.prefix}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.appClient.userPoolClientId,
      description: 'Cognito App Client ID',
      exportName: `${config.prefix}-app-client-id`,
    });

    if (this.webAcl) {
      new cdk.CfnOutput(this, 'WebAclArn', {
        value: this.webAcl.attrArn,
        description: 'WAF WebACL ARN',
        exportName: `${config.prefix}-web-acl-arn`,
      });
    }
  }
}
