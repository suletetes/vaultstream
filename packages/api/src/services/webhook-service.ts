/**
 * WebhookService — Webhook registration, delivery, retry, and HMAC signing
 *
 * - register: Store webhook config in DynamoDB
 * - deliver: Send HTTP POST with HMAC-SHA256 signed payload
 * - retry: Exponential backoff (1s, 5s, 30s, max 3 attempts)
 * - Pause after 10 consecutive failures
 * - Max 5 webhooks per enterprise user
 * - Enterprise tier only (FORBIDDEN for free/pro)
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8
 */

import crypto from 'crypto';
import { getDynamoDBDocClient } from '../db/dynamodb';
import { PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AppError } from '@vaultstream/shared';
import { generateUlid } from '@vaultstream/shared';
import pino from 'pino';

const logger = pino({ name: 'webhook-service' });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'vaultstream-metadata';
const MAX_WEBHOOKS_PER_USER = 5;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s
const MAX_CONSECUTIVE_FAILURES = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  webhookId: string;
  userId: string;
  url: string;
  secret: string;
  events: string[];
  status: 'active' | 'paused' | 'failing';
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  deliveryId: string;
  webhookId: string;
  eventType: string;
  status: 'success' | 'failed' | 'pending';
  statusCode?: number;
  latencyMs?: number;
  attempts: number;
  lastAttemptAt: string;
  error?: string;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── HMAC Signing ───────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 */
export function computeHmacSignature(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature.
 */
export function verifyHmacSignature(secret: string, payload: string, signature: string): boolean {
  const expected = computeHmacSignature(secret, payload);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

// ─── Service ────────────────────────────────────────────────────────────────

export class WebhookService {
  /**
   * Register a new webhook endpoint.
   * Enterprise tier only. Max 5 per user.
   */
  async register(params: {
    userId: string;
    tier: string;
    url: string;
    secret: string;
    events: string[];
  }): Promise<WebhookConfig> {
    // Enforce enterprise tier
    if (params.tier !== 'enterprise') {
      throw new AppError('FORBIDDEN', 'Webhooks are available for enterprise tier only', 403);
    }

    // Check existing webhook count
    const existing = await this.listWebhooks(params.userId);
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Maximum ${MAX_WEBHOOKS_PER_USER} webhooks per user`,
        400
      );
    }

    const webhookId = `webhook_${generateUlid()}`;
    const now = new Date().toISOString();

    const webhook: WebhookConfig = {
      webhookId,
      userId: params.userId,
      url: params.url,
      secret: params.secret,
      events: params.events,
      status: 'active',
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    };

    const client = getDynamoDBDocClient();
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${params.userId}`,
        SK: `WEBHOOK#${webhookId}`,
        entityType: 'WEBHOOK',
        ...webhook,
      },
    }));

    return webhook;
  }

  /**
   * List all webhooks for a user.
   */
  async listWebhooks(userId: string): Promise<WebhookConfig[]> {
    const client = getDynamoDBDocClient();
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'WEBHOOK#',
      },
    }));

    return (result.Items || []).map((item) => ({
      webhookId: item.webhookId as string,
      userId: item.userId as string,
      url: item.url as string,
      secret: item.secret as string,
      events: item.events as string[],
      status: item.status as 'active' | 'paused' | 'failing',
      consecutiveFailures: item.consecutiveFailures as number,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }));
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(userId: string, webhookId: string): Promise<void> {
    const client = getDynamoDBDocClient();
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `WEBHOOK#${webhookId}`,
      },
    }));
  }

  /**
   * Deliver a webhook payload to the registered URL.
   * Signs with HMAC-SHA256 and retries on failure.
   */
  async deliver(webhook: WebhookConfig, payload: WebhookPayload): Promise<WebhookDelivery> {
    if (webhook.status === 'paused') {
      return {
        deliveryId: `del_${generateUlid()}`,
        webhookId: webhook.webhookId,
        eventType: payload.event,
        status: 'failed',
        attempts: 0,
        lastAttemptAt: new Date().toISOString(),
        error: 'Webhook is paused due to consecutive failures',
      };
    }

    const payloadString = JSON.stringify(payload);
    const signature = computeHmacSignature(webhook.secret, payloadString);

    let lastError: string | undefined;
    let statusCode: number | undefined;
    let latencyMs: number | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.delay(RETRY_DELAYS[attempt - 1]);
      }

      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-VaultStream-Signature': signature,
            'X-VaultStream-Event': payload.event,
            'X-VaultStream-Delivery': `del_${generateUlid()}`,
          },
          body: payloadString,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        latencyMs = Date.now() - startTime;
        statusCode = response.status;

        if (response.ok) {
          // Success — reset failure counter
          await this.resetFailureCount(webhook);
          return {
            deliveryId: `del_${generateUlid()}`,
            webhookId: webhook.webhookId,
            eventType: payload.event,
            status: 'success',
            statusCode,
            latencyMs,
            attempts: attempt + 1,
            lastAttemptAt: new Date().toISOString(),
          };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (error) {
        latencyMs = Date.now() - startTime;
        lastError = (error as Error).message;
        logger.warn({ webhookId: webhook.webhookId, attempt, error: lastError }, 'Webhook delivery failed');
      }
    }

    // All retries exhausted — increment failure counter
    await this.incrementFailureCount(webhook);

    return {
      deliveryId: `del_${generateUlid()}`,
      webhookId: webhook.webhookId,
      eventType: payload.event,
      status: 'failed',
      statusCode,
      latencyMs,
      attempts: MAX_RETRIES,
      lastAttemptAt: new Date().toISOString(),
      error: lastError,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async resetFailureCount(webhook: WebhookConfig): Promise<void> {
    const client = getDynamoDBDocClient();
    await client.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${webhook.userId}`, SK: `WEBHOOK#${webhook.webhookId}` },
      UpdateExpression: 'SET consecutiveFailures = :zero, #status = :active, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':zero': 0, ':active': 'active', ':now': new Date().toISOString() },
    }));
  }

  private async incrementFailureCount(webhook: WebhookConfig): Promise<void> {
    const newCount = webhook.consecutiveFailures + 1;
    const newStatus = newCount >= MAX_CONSECUTIVE_FAILURES ? 'paused' : 'failing';

    const client = getDynamoDBDocClient();
    await client.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${webhook.userId}`, SK: `WEBHOOK#${webhook.webhookId}` },
      UpdateExpression: 'SET consecutiveFailures = :count, #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':count': newCount, ':status': newStatus, ':now': new Date().toISOString() },
    }));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const webhookService = new WebhookService();
