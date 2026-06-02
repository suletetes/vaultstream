/**
 * Cache Module
 *
 * Exports Redis client and CacheService for use across the API.
 */

export { createRedisClient, getRedisClient, disconnectRedis, buildRedisOptions, resetRedisInstance } from './redis-client.js';
export type { RedisClientOptions } from './redis-client.js';
export { RedisCacheService } from './cache-service.js';
export type { CacheService } from './cache-service.js';
