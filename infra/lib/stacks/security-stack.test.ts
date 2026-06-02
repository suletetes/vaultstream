import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SecurityStack } from './security-stack';
import { devConfig, prodConfig } from '../config';

function createStack(config = prodConfig): { template: Template; stack: SecurityStack } {
  const app = new cdk.App();
  const stack = new SecurityStack(app, 'TestSecurityStack', {
    config,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  return { template, stack };
}

describe('SecurityStack', () => {
  describe('KMS CMK', () => {
    it('should create a symmetric KMS key with annual rotation', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::KMS::Key', {
        EnableKeyRotation: true,
        KeySpec: 'SYMMETRIC_DEFAULT',
        KeyUsage: 'ENCRYPT_DECRYPT',
        PendingWindowInDays: 30,
      });
    });

    it('should create a KMS alias with the correct prefix', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::KMS::Alias', {
        AliasName: 'alias/vaultstream-prod-master-key',
      });
    });

    it('should set RETAIN removal policy when deletion protection is enabled', () => {
      const { template } = createStack(prodConfig);
      template.hasResource('AWS::KMS::Key', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });

    it('should set DELETE removal policy when deletion protection is disabled', () => {
      const { template } = createStack(devConfig);
      template.hasResource('AWS::KMS::Key', {
        DeletionPolicy: 'Delete',
      });
    });

    it('should include key policy allowing API Lambda role usage', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::KMS::Key', {
        KeyPolicy: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowAPILambdaKeyUsage',
              Effect: 'Allow',
              Action: ['kms:GenerateDataKey', 'kms:Decrypt', 'kms:DescribeKey'],
            }),
          ]),
        }),
      });
    });

    it('should include key policy allowing S3 service with ViaService condition', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::KMS::Key', {
        KeyPolicy: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowS3ServiceKeyUsage',
              Effect: 'Allow',
              Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
              Condition: {
                StringEquals: {
                  'kms:ViaService': 's3.us-east-1.amazonaws.com',
                },
              },
            }),
          ]),
        }),
      });
    });
  });

  describe('Cognito User Pool', () => {
    it('should create a user pool with email sign-in', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
      });
    });

    it('should configure optional MFA with TOTP', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'OPTIONAL',
        EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      });
    });

    it('should enforce password policy: min 12 chars, uppercase, lowercase, numbers, symbols', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 12,
            RequireUppercase: true,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            TemporaryPasswordValidityDays: 3,
          },
        },
      });
    });

    it('should configure PostConfirmation Lambda trigger', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: {
          PostConfirmation: Match.anyValue(),
        },
      });
    });

    it('should create PostConfirmation Lambda with correct memory and timeout', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: prodConfig.compute.postSignupLambdaMemory,
        Timeout: prodConfig.compute.postSignupLambdaTimeout,
        Runtime: 'nodejs20.x',
      });
    });
  });

  describe('Cognito App Client', () => {
    it('should create a public client with no secret', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
      });
    });

    it('should configure OAuth with Authorization Code grant and PKCE scopes', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: ['openid', 'email', 'profile'],
        AllowedOAuthFlowsUserPoolClient: true,
      });
    });

    it('should set correct token validity: access 1h, ID 1h, refresh 30d', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        AccessTokenValidity: 60,
        IdTokenValidity: 60,
        RefreshTokenValidity: 43200,
        TokenValidityUnits: {
          AccessToken: 'minutes',
          IdToken: 'minutes',
          RefreshToken: 'minutes',
        },
      });
    });

    it('should configure callback URLs', () => {
      const { template } = createStack();
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        CallbackURLs: [
          'https://app.vaultstream.dev/callback',
          'http://localhost:3000/callback',
        ],
      });
    });
  });

  describe('WAF WebACL', () => {
    it('should create WAF WebACL when wafEnabled is true (prod)', () => {
      const { template } = createStack(prodConfig);
      template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    });

    it('should NOT create WAF WebACL when wafEnabled is false (dev)', () => {
      const { template } = createStack(devConfig);
      template.resourceCountIs('AWS::WAFv2::WebACL', 0);
    });

    it('should configure WAF with CLOUDFRONT scope', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: 'CLOUDFRONT',
        DefaultAction: { Allow: {} },
      });
    });

    it('should include rate limit rule (1000 req/5min per IP)', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'RateLimitPerIP',
            Statement: {
              RateBasedStatement: {
                Limit: 1000,
                AggregateKeyType: 'IP',
              },
            },
          }),
        ]),
      });
    });

    it('should include SQL injection rule', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'SQLInjectionProtection',
            Statement: {
              SqliMatchStatement: Match.anyValue(),
            },
          }),
        ]),
      });
    });

    it('should include XSS protection rule', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'XSSProtection',
            Statement: {
              XssMatchStatement: Match.anyValue(),
            },
          }),
        ]),
      });
    });

    it('should include Bot Control managed rule group', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'BotControl',
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesBotControlRuleSet',
              },
            },
          }),
        ]),
      });
    });

    it('should include geo-block rule for sanctioned countries', () => {
      const { template } = createStack(prodConfig);
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'GeoBlockSanctionedCountries',
            Statement: {
              GeoMatchStatement: {
                CountryCodes: ['KP', 'IR', 'CU', 'SY'],
              },
            },
          }),
        ]),
      });
    });
  });

  describe('Stack Exports', () => {
    it('should expose masterKey property', () => {
      const { stack } = createStack();
      expect(stack.masterKey).toBeDefined();
    });

    it('should expose userPool property', () => {
      const { stack } = createStack();
      expect(stack.userPool).toBeDefined();
    });

    it('should expose appClient property', () => {
      const { stack } = createStack();
      expect(stack.appClient).toBeDefined();
    });

    it('should expose webAcl property when WAF is enabled', () => {
      const { stack } = createStack(prodConfig);
      expect(stack.webAcl).toBeDefined();
    });

    it('should NOT expose webAcl property when WAF is disabled', () => {
      const { stack } = createStack(devConfig);
      expect(stack.webAcl).toBeUndefined();
    });
  });
});
