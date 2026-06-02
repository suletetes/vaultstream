import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { type EnvironmentConfig } from '../config';

/**
 * Props for the MessagingStack.
 */
export interface MessagingStackProps extends cdk.StackProps {
  /** Environment configuration */
  config: EnvironmentConfig;
  /** Optional S3 files bucket name for EventBridge rule matching */
  filesBucketName?: string;
}

/**
 * MessagingStack provisions event-driven messaging infrastructure for VaultStream:
 * - EventBridge event bus with rules for S3 Object Created events
 * - SQS queues for thumbnail generation and virus scanning with DLQs
 * - SNS topic for user notifications with email subscription support
 *
 * Requirements: 8.5, 9.5, 10.5, 39.1
 */
export class MessagingStack extends cdk.Stack {
  /** SQS queue for thumbnail generation processing */
  public readonly thumbnailQueue: sqs.Queue;
  /** Dead-letter queue for failed thumbnail messages */
  public readonly thumbnailDlq: sqs.Queue;
  /** SQS queue for virus scanning processing */
  public readonly virusScanQueue: sqs.Queue;
  /** Dead-letter queue for failed virus scan messages */
  public readonly virusScanDlq: sqs.Queue;
  /** SNS topic for user notifications */
  public readonly notificationsTopic: sns.Topic;
  /** EventBridge event bus for routing S3 events */
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { config, filesBucketName } = props;

    // -------------------------------------------------------------------------
    // EventBridge Event Bus
    // Custom event bus for VaultStream domain events
    // -------------------------------------------------------------------------
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `${config.prefix}-event-bus`,
    });

    // -------------------------------------------------------------------------
    // SQS Dead-Letter Queues
    // 14-day message retention for failed message inspection
    // -------------------------------------------------------------------------
    this.thumbnailDlq = new sqs.Queue(this, 'ThumbnailDLQ', {
      queueName: `${config.prefix}-thumbnail-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.virusScanDlq = new sqs.Queue(this, 'VirusScanDLQ', {
      queueName: `${config.prefix}-virus-scan-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // -------------------------------------------------------------------------
    // SQS Processing Queues
    // Requirement 8.5: Thumbnail queue with 3 max receives before DLQ
    // Requirement 9.5: Virus scan queue with 3 max receives before DLQ
    // -------------------------------------------------------------------------
    this.thumbnailQueue = new sqs.Queue(this, 'ThumbnailQueue', {
      queueName: `${config.prefix}-thumbnail-queue`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(120),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.thumbnailDlq,
        maxReceiveCount: 3,
      },
    });

    this.virusScanQueue = new sqs.Queue(this, 'VirusScanQueue', {
      queueName: `${config.prefix}-virus-scan-queue`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(600),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.virusScanDlq,
        maxReceiveCount: 3,
      },
    });

    // -------------------------------------------------------------------------
    // SNS Notifications Topic
    // Requirement 39.1: SNS topic for user notifications (share, quota, virus)
    // -------------------------------------------------------------------------
    this.notificationsTopic = new sns.Topic(this, 'NotificationsTopic', {
      topicName: `${config.prefix}-notifications`,
      displayName: 'VaultStream Notifications',
    });

    // -------------------------------------------------------------------------
    // EventBridge Rules
    // Route S3 Object Created events from the files bucket to processing queues
    // -------------------------------------------------------------------------
    const bucketName = filesBucketName ?? `${config.prefix}-files-*`;

    // Rule: Route S3 Object Created events to thumbnail queue
    // Uses input transformer to extract bucket, key, and size
    new events.Rule(this, 'S3ObjectCreatedToThumbnailRule', {
      ruleName: `${config.prefix}-s3-to-thumbnail`,
      eventBus: this.eventBus,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [{ prefix: bucketName.replace('*', '') }],
          },
        },
      },
      targets: [
        new events_targets.SqsQueue(this.thumbnailQueue, {
          message: events.RuleTargetInput.fromObject({
            bucket: events.EventField.fromPath('$.detail.bucket.name'),
            key: events.EventField.fromPath('$.detail.object.key'),
            size: events.EventField.fromPath('$.detail.object.size'),
          }),
        }),
      ],
    });

    // Rule: Route S3 Object Created events to virus scan queue
    new events.Rule(this, 'S3ObjectCreatedToVirusScanRule', {
      ruleName: `${config.prefix}-s3-to-virus-scan`,
      eventBus: this.eventBus,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [{ prefix: bucketName.replace('*', '') }],
          },
        },
      },
      targets: [
        new events_targets.SqsQueue(this.virusScanQueue),
      ],
    });

    // -------------------------------------------------------------------------
    // CloudFormation Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ThumbnailQueueUrl', {
      value: this.thumbnailQueue.queueUrl,
      description: 'Thumbnail processing SQS queue URL',
      exportName: `${config.prefix}-thumbnail-queue-url`,
    });

    new cdk.CfnOutput(this, 'ThumbnailQueueArn', {
      value: this.thumbnailQueue.queueArn,
      description: 'Thumbnail processing SQS queue ARN',
      exportName: `${config.prefix}-thumbnail-queue-arn`,
    });

    new cdk.CfnOutput(this, 'VirusScanQueueUrl', {
      value: this.virusScanQueue.queueUrl,
      description: 'Virus scan processing SQS queue URL',
      exportName: `${config.prefix}-virus-scan-queue-url`,
    });

    new cdk.CfnOutput(this, 'VirusScanQueueArn', {
      value: this.virusScanQueue.queueArn,
      description: 'Virus scan processing SQS queue ARN',
      exportName: `${config.prefix}-virus-scan-queue-arn`,
    });

    new cdk.CfnOutput(this, 'NotificationsTopicArn', {
      value: this.notificationsTopic.topicArn,
      description: 'Notifications SNS topic ARN',
      exportName: `${config.prefix}-notifications-topic-arn`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge event bus name',
      exportName: `${config.prefix}-event-bus-name`,
    });
  }

  /**
   * Add an email subscription to the notifications topic.
   * Useful for admin alerts or user notification delivery.
   */
  public addEmailSubscription(email: string): void {
    this.notificationsTopic.addSubscription(
      new sns_subscriptions.EmailSubscription(email),
    );
  }
}
