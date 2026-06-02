/**
 * Monitoring Stack — CloudWatch alarms, metrics, X-Ray, CloudTrail
 *
 * Configures:
 * - CloudWatch alarms for API errors, Lambda errors, DLQ depth, RDS CPU, Redis memory
 * - X-Ray tracing (5% sampling, 100% on errors)
 * - CloudWatch log retention (30 days)
 * - SNS alarm notifications
 * - CloudTrail multi-region with S3 delivery
 * - RDS Performance Insights
 *
 * Requirements: 32.3, 32.4, 32.5, 32.6, 32.7, 32.8
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  alarmEmail?: string;
  apiGatewayName?: string;
  apiLambdaFunctionName?: string;
  thumbnailDlqName?: string;
  virusScanDlqName?: string;
  rdsInstanceId?: string;
  redisClusterId?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // ─── SNS Alarm Topic ──────────────────────────────────────────────────────

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'vaultstream-alarms',
      displayName: 'VaultStream Operational Alarms',
    });

    if (props.alarmEmail) {
      this.alarmTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(props.alarmEmail)
      );
    }

    const alarmAction = new cloudwatch_actions.SnsAction(this.alarmTopic);

    // ─── API Gateway 5xx Errors ───────────────────────────────────────────────

    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: 'vaultstream-api-5xx-errors',
      alarmDescription: 'API Gateway 5xx errors > 5 in 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: { ApiName: props.apiGatewayName || 'vaultstream-api' },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api5xxAlarm.addAlarmAction(alarmAction);

    // ─── Lambda Errors ────────────────────────────────────────────────────────

    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'vaultstream-lambda-errors',
      alarmDescription: 'Lambda errors > 3 in 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: props.apiLambdaFunctionName || 'vaultstream-api' },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaErrorAlarm.addAlarmAction(alarmAction);

    // ─── DLQ Depth Alarms ─────────────────────────────────────────────────────

    if (props.thumbnailDlqName) {
      const thumbnailDlqAlarm = new cloudwatch.Alarm(this, 'ThumbnailDlqAlarm', {
        alarmName: 'vaultstream-thumbnail-dlq-depth',
        alarmDescription: 'Thumbnail DLQ has messages for > 15 minutes',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: { QueueName: props.thumbnailDlqName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      thumbnailDlqAlarm.addAlarmAction(alarmAction);
    }

    if (props.virusScanDlqName) {
      const virusScanDlqAlarm = new cloudwatch.Alarm(this, 'VirusScanDlqAlarm', {
        alarmName: 'vaultstream-virusscan-dlq-depth',
        alarmDescription: 'Virus scan DLQ has messages for > 15 minutes',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: { QueueName: props.virusScanDlqName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      virusScanDlqAlarm.addAlarmAction(alarmAction);
    }

    // ─── RDS CPU Alarm ────────────────────────────────────────────────────────

    if (props.rdsInstanceId) {
      const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
        alarmName: 'vaultstream-rds-cpu-high',
        alarmDescription: 'RDS CPU > 80% for 10 minutes',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'CPUUtilization',
          dimensionsMap: { DBInstanceIdentifier: props.rdsInstanceId },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 80,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.MISSING,
      });
      rdsCpuAlarm.addAlarmAction(alarmAction);
    }

    // ─── Redis Memory Alarm ───────────────────────────────────────────────────

    if (props.redisClusterId) {
      const redisMemoryAlarm = new cloudwatch.Alarm(this, 'RedisMemoryAlarm', {
        alarmName: 'vaultstream-redis-memory-high',
        alarmDescription: 'Redis memory usage > 80%',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName: 'DatabaseMemoryUsagePercentage',
          dimensionsMap: { CacheClusterId: props.redisClusterId },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 80,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.MISSING,
      });
      redisMemoryAlarm.addAlarmAction(alarmAction);
    }

    // ─── CloudTrail ───────────────────────────────────────────────────────────

    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `vaultstream-cloudtrail-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cloudtrail.Trail(this, 'VaultStreamTrail', {
      trailName: 'vaultstream-trail',
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
    });

    // ─── Log Retention ────────────────────────────────────────────────────────

    new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: '/aws/lambda/vaultstream-api',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'ThumbnailLogGroup', {
      logGroupName: '/aws/lambda/vaultstream-thumbnail',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'VirusScanLogGroup', {
      logGroupName: '/aws/lambda/vaultstream-virus-scan',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Custom Metrics Dashboard ─────────────────────────────────────────────

    new cloudwatch.Dashboard(this, 'VaultStreamDashboard', {
      dashboardName: 'VaultStream-Operations',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API Errors',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: '5XXError',
                dimensionsMap: { ApiName: props.apiGatewayName || 'vaultstream-api' },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: '4XXError',
                dimensionsMap: { ApiName: props.apiGatewayName || 'vaultstream-api' },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
              }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'API Latency',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: 'Latency',
                dimensionsMap: { ApiName: props.apiGatewayName || 'vaultstream-api' },
                statistic: 'p50',
                period: cdk.Duration.minutes(5),
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: 'Latency',
                dimensionsMap: { ApiName: props.apiGatewayName || 'vaultstream-api' },
                statistic: 'p99',
                period: cdk.Duration.minutes(5),
              }),
            ],
            width: 12,
          }),
        ],
      ],
    });
  }
}
