/**
 * CloudWatch Custom Metrics Publisher
 *
 * Publishes custom metrics: FileUploads, FileDownloads, SharesCreated,
 * CacheHitRatio, PresignedUrlLatency, StorageUsedBytes.
 *
 * Requirements: 32.2, 16.10
 *
 * NOTE: @aws-sdk/client-cloudwatch is not yet installed.
 * These are stub functions that will be connected when the dependency is added.
 */

import pino from 'pino';

const logger = pino({ name: 'cloudwatch-metrics' });

/**
 * Record a custom metric (stub — logs locally until CloudWatch SDK is installed).
 */
export function recordMetric(params: {
  name: string;
  value: number;
  unit: 'Count' | 'Milliseconds' | 'Bytes' | 'Percent';
  dimensions?: Array<{ Name: string; Value: string }>;
}): void {
  logger.debug({ metric: params.name, value: params.value, unit: params.unit }, 'Metric recorded (stub)');
}

/**
 * Flush buffered metrics to CloudWatch (stub — no-op until SDK is installed).
 */
export async function flushMetrics(): Promise<void> {
  // No-op stub
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
