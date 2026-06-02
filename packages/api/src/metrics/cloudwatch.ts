/**
 * CloudWatch Custom Metrics Publisher
 *
 * Publishes custom metrics: FileUploads, FileDownloads, SharesCreated,
 * CacheHitRatio, PresignedUrlLatency, StorageUsedBytes.
 *
 * Requirements: 32.2, 16.10
 */

import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';
import pino from 'pino';

const logger = pino({ name: 'cloudwatch-metrics' });

const NAMESPACE = 'VaultStream';

const client = new CloudWatchClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT_URL && { endpoint: process.env.AWS_ENDPOINT_URL }),
});

// Buffer metrics and flush periodically to reduce API calls
let metricBuffer: MetricDatum[] = [];
const FLUSH_INTERVAL_MS = 60_000; // 1 minute
const MAX_BUFFER_SIZE = 20;

/**
 * Record a custom metric.
 */
export function recordMetric(params: {
  name: string;
  value: number;
  unit: 'Count' | 'Milliseconds' | 'Bytes' | 'Percent';
  dimensions?: Array<{ Name: string; Value: string }>;
}): void {
  const datum: MetricDatum = {
    MetricName: params.name,
    Value: params.value,
    Unit: params.unit,
    Timestamp: new Date(),
    Dimensions: params.dimensions,
  };

  metricBuffer.push(datum);

  if (metricBuffer.length >= MAX_BUFFER_SIZE) {
    flushMetrics();
  }
}

/**
 * Flush buffered metrics to CloudWatch.
 */
export async function flushMetrics(): Promise<void> {
  if (metricBuffer.length === 0) return;

  const dataToSend = [...metricBuffer];
  metricBuffer = [];

  try {
    await client.send(new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: dataToSend,
    }));
  } catch (error) {
    logger.warn({ err: (error as Error).message, count: dataToSend.length }, 'Failed to publish CloudWatch metrics');
    // Don't re-buffer on failure — metrics are best-effort
  }
}

// ─── Convenience Methods ────────────────────────────────────────────────────

export function recordFileUpload(mimeType: string): void {
  recordMetric({ name: 'FileUploads', value: 1, unit: 'Count', dimensions: [{ Name: 'MimeType', Value: mimeType }] });
}

export function recordFileDownload(): void {
  recordMetric({ name: 'FileDownloads', value: 1, unit: 'Count' });
}

export function recordShareCreated(): void {
  recordMetric({ name: 'SharesCreated', value: 1, unit: 'Count' });
}

export function recordCacheHitRatio(ratio: number): void {
  recordMetric({ name: 'CacheHitRatio', value: ratio, unit: 'Percent' });
}

export function recordPresignedUrlLatency(ms: number): void {
  recordMetric({ name: 'PresignedUrlLatency', value: ms, unit: 'Milliseconds' });
}

export function recordStorageUsed(userId: string, bytes: number): void {
  recordMetric({ name: 'StorageUsedBytes', value: bytes, unit: 'Bytes', dimensions: [{ Name: 'UserId', Value: userId }] });
}

// Periodic flush
setInterval(() => {
  flushMetrics().catch(() => {});
}, FLUSH_INTERVAL_MS);
