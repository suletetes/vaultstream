/**
 * Redis Client Configuration
 *
 * Connects to ElastiCache Redis with TLS and AUTH support.
 * Handles connection errors gracefully - logs and continues without cache.
 */

import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'redis-client' });

export interface RedisClientOptions {
  host: string;
  port: number;
  password?: string;
  tlsEnabled?: boolean;
  connectTimeout?: number;
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
}

/**
 * Build Redis client options from environment variables.
 */
export function buildRedisOptions(): RedisClientOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tlsEnabled: process.env.REDIS_TLS_ENABLED === 'true',
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '5000', 10),
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  };
}

/**
 * Create a configured ioredis client instance.
 * Supports TLS when REDIS_TLS_ENABLED=true and AUTH via REDIS_PASSWORD.
 */
export function createRedisClient(options?: RedisClientOptions): Redis {
  const opts = options ?? buildRedisOptions();

  const redisClient = new Redis({
    host: opts.host,
    port: opts.port,
    password: opts.password,
    tls: opts.tlsEnabled ? { rejectUnauthorized: true } : undefined,
    connectTimeout: opts.connectTimeout ?? 5000,
    maxRetriesPerRequest: opts.maxRetriesPerRequest ?? 1,
    lazyConnect: opts.lazyConnect ?? true,
    retryStrategy(times: number): number | null {
      if (times > 3) {
        logger.warn({ times }, 'Redis retry limit reached, stopping reconnection attempts');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    reconnectOnError(err: Error): boolean {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some((e) => err.message.includes(e));
    },
  });

  redisClient.on('connect', () => {
    logger.info('Redis client connected');
  });

  redisClient.on('ready', () => {
    logger.info('Redis client ready');
  });

  redisClient.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis client error');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

/** Singleton Redis client instance */
let redisInstance: Redis | null = null;

/**
 * Get or create the singleton Redis client.
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = createRedisClient();
  }
  return redisInstance;
}

/**
 * Disconnect and reset the singleton Redis client.
 * Useful for testing and graceful shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit().catch(() => {
      // Ignore errors during disconnect
    });
    redisInstance = null;
  }
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetRedisInstance(): void {
  redisInstance = null;
}
