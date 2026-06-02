import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeEach } from 'vitest';
import { MessagingStack } from './messaging-stack';
import { devConfig } from '../config';

describe('MessagingStack', () => {
  let app: cdk.App;
  let stack: MessagingStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new MessagingStack(app, 'TestMessagingStack', {
      config: devConfig,
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('EventBridge Event Bus', () => {
    it('should create a custom event bus with correct name', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'vaultstream-dev-event-bus',
      });
    });
  });

  describe('Thumbnail Queue', () => {
    it('should create thumbnail queue with correct name', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-queue',
      });
    });

    it('should configure 14-day message retention on thumbnail queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-queue',
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });

    it('should configure 120s visibility timeout on thumbnail queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-queue',
        VisibilityTimeout: 120,
      });
    });

    it('should configure DLQ with maxReceiveCount of 3 on thumbnail queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-queue',
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });
  });

  describe('Thumbnail DLQ', () => {
    it('should create thumbnail DLQ with correct name', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-dlq',
      });
    });

    it('should configure 14-day retention on thumbnail DLQ', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-dlq',
        MessageRetentionPeriod: 1209600,
      });
    });
  });

  describe('Virus Scan Queue', () => {
    it('should create virus scan queue with correct name', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-queue',
      });
    });

    it('should configure 14-day message retention on virus scan queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-queue',
        MessageRetentionPeriod: 1209600,
      });
    });

    it('should configure 600s visibility timeout on virus scan queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-queue',
        VisibilityTimeout: 600,
      });
    });

    it('should configure DLQ with maxReceiveCount of 3 on virus scan queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-queue',
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });
  });

  describe('Virus Scan DLQ', () => {
    it('should create virus scan DLQ with correct name', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-dlq',
      });
    });

    it('should configure 14-day retention on virus scan DLQ', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-dlq',
        MessageRetentionPeriod: 1209600,
      });
    });
  });

  describe('SNS Notifications Topic', () => {
    it('should create notifications topic with correct name', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'vaultstream-dev-notifications',
      });
    });

    it('should set display name on notifications topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        DisplayName: 'VaultStream Notifications',
      });
    });
  });

  describe('EventBridge Rules', () => {
    it('should create rule to route S3 events to thumbnail queue', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'vaultstream-dev-s3-to-thumbnail',
        EventPattern: Match.objectLike({
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
        }),
      });
    });

    it('should create rule to route S3 events to virus scan queue', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'vaultstream-dev-s3-to-virus-scan',
        EventPattern: Match.objectLike({
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
        }),
      });
    });

    it('should have thumbnail rule with input transformer target', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'vaultstream-dev-s3-to-thumbnail',
        Targets: Match.arrayWith([
          Match.objectLike({
            InputTransformer: Match.objectLike({
              InputPathsMap: {
                'detail-bucket-name': '$.detail.bucket.name',
                'detail-object-key': '$.detail.object.key',
                'detail-object-size': '$.detail.object.size',
              },
            }),
          }),
        ]),
      });
    });

    it('should associate rules with the custom event bus', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'vaultstream-dev-s3-to-thumbnail',
        EventBusName: Match.objectLike({
          Ref: Match.anyValue(),
        }),
      });
    });
  });

  describe('SQS Encryption', () => {
    it('should enable SQS managed encryption on thumbnail queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-queue',
        SqsManagedSseEnabled: true,
      });
    });

    it('should enable SQS managed encryption on virus scan queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-queue',
        SqsManagedSseEnabled: true,
      });
    });

    it('should enable SQS managed encryption on thumbnail DLQ', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-thumbnail-dlq',
        SqsManagedSseEnabled: true,
      });
    });

    it('should enable SQS managed encryption on virus scan DLQ', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'vaultstream-dev-virus-scan-dlq',
        SqsManagedSseEnabled: true,
      });
    });
  });

  describe('Stack Outputs', () => {
    it('should export thumbnail queue URL', () => {
      template.hasOutput('ThumbnailQueueUrl', {});
    });

    it('should export thumbnail queue ARN', () => {
      template.hasOutput('ThumbnailQueueArn', {});
    });

    it('should export virus scan queue URL', () => {
      template.hasOutput('VirusScanQueueUrl', {});
    });

    it('should export virus scan queue ARN', () => {
      template.hasOutput('VirusScanQueueArn', {});
    });

    it('should export notifications topic ARN', () => {
      template.hasOutput('NotificationsTopicArn', {});
    });

    it('should export event bus name', () => {
      template.hasOutput('EventBusName', {});
    });
  });

  describe('Exported properties', () => {
    it('should expose thumbnailQueue as public property', () => {
      expect(stack.thumbnailQueue).toBeDefined();
    });

    it('should expose virusScanQueue as public property', () => {
      expect(stack.virusScanQueue).toBeDefined();
    });

    it('should expose thumbnailDlq as public property', () => {
      expect(stack.thumbnailDlq).toBeDefined();
    });

    it('should expose virusScanDlq as public property', () => {
      expect(stack.virusScanDlq).toBeDefined();
    });

    it('should expose notificationsTopic as public property', () => {
      expect(stack.notificationsTopic).toBeDefined();
    });

    it('should expose eventBus as public property', () => {
      expect(stack.eventBus).toBeDefined();
    });
  });

  describe('Email subscription support', () => {
    it('should support adding email subscriptions to notifications topic', () => {
      const appWithEmail = new cdk.App();
      const stackWithEmail = new MessagingStack(appWithEmail, 'TestMessagingStackEmail', {
        config: devConfig,
        env: { account: '123456789012', region: 'us-east-1' },
      });
      stackWithEmail.addEmailSubscription('admin@vaultstream.dev');
      const templateWithEmail = Template.fromStack(stackWithEmail);

      templateWithEmail.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'email',
        Endpoint: 'admin@vaultstream.dev',
      });
    });
  });
});
