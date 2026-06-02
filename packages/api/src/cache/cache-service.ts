/**
 * CacheService Implementation
 *
 * Implements cache-aside pattern with Redis for VaultStream.
 * All methods gracefully degrade - catch Redis errors and return null/void.
 * Uses Redis pipelining for batch operations.
 *
 * Key patterns:
 * - user:{userId}:recent     → Sorted Set (TTL 5min)
 * - user:{userId}:shared     → Sorted Set (TTL 5min)
 * - file:{fileId}:meta       → String/JSON (TTL 10min)
 * - user:{userId}:folders:{folderId} → Hash (TTL 10min)
 */

import type Redis from 'ioredis';
import pino from 'pino';
import { CACHE_TTL } from '@vaultstream/shared';
import type { FileEntity, ShareEntity } from '@vaultstream/shared';

const logger = pino({ name: 'cache-service' });

export interface CacheService {
  getRecentFiles(userId: string): Promise<FileEntity[] | null>;
  setRecentFiles(userId: string, files: FileEntity[]): Promise<void>;
  getSharedWithMe(userId: string): Promise<ShareEntity[] | null>;
  setSharedWithMe(userId: string, shares: ShareEntity[]): Promise<void>;
  getFileMetadata(fileId: string): Promise<FileEntity | null>;
  setFileMetadata(fileId: string, metadata: FileEntity): Promise<void>;
  getFolderContents(userId: string, folderId: string): Promise<Record<string, string> | null>;
  setFolderContents(userId: string, folderId: string, contents: Record<string, string>): Promise<void>;
  invalidateUserCache(userId: string): Promise<void>;
  invalidateFileCache(fileId: string): Promise<void>;
  invalidateFolderCache(userId: string, folderId: string): Promise<void>;
  isAvailable(): boolean;
}

export class RedisCacheService implements CacheService {
  private readonly redis: Redis;
  private connected = false;

  constructor(redisClient: Redis) {
    this.redis = redisClient;

    this.redis.on('ready', () => {
      this.connected = true;
    });

    this.redis.on('error', () => {
      this.connected = false;
    });

    this.redis.on('close', () => {
      this.connected = false;
    });

    this.redis.on('end', () => {
      this.connected = false;
    });

    // Check initial status
    if (this.redis.status === 'ready') {
      this.connected = true;
    }
  }

  /**
   * Check if Redis is currently connected and available.
   */
  isAvailable(): boolean {
    return this.connected && this.redis.status === 'ready';
  }

  // ─── Recent Files (Sorted Set, TTL 5min) ─────────────────────────────────

  /**
   * Get recently accessed files from Redis sorted set.
   * Returns null on cache miss or Redis error (graceful degradation).
   */
  async getRecentFiles(userId: string): Promise<FileEntity[] | null> {
    if (!this.isAvailable()) return null;

    try {
      const key = `user:${userId}:recent`;
      const results = await this.redis.zrevrange(key, 0, -1);

      if (!results || results.length === 0) {
        return null;
      }

      return results.map((item) => JSON.parse(item) as FileEntity);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to get recent files from cache');
      return null;
    }
  }

  /**
   * Populate the recent files sorted set using pipelining.
   * Score is the lastAccessedAt timestamp (epoch ms).
   */
  async setRecentFiles(userId: string, files: FileEntity[]): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const key = `user:${userId}:recent`;
      const pipeline = this.redis.pipeline();

      // Clear existing set
      pipeline.del(key);

      // Add all files with lastAccessedAt as score
      for (const file of files) {
        const score = new Date(file.lastAccessedAt).getTime();
        pipeline.zadd(key, score.toString(), JSON.stringify(file));
      }

      // Set TTL
      pipeline.expire(key, CACHE_TTL.recentFiles);

      await pipeline.exec();
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to set recent files in cache');
    }
  }

  // ─── Shared With Me (Sorted Set, TTL 5min) ───────────────────────────────

  /**
   * Get shared-with-me data from Redis sorted set.
   * Returns null on cache miss or Redis error.
   */
  async getSharedWithMe(userId: string): Promise<ShareEntity[] | null> {
    if (!this.isAvailable()) return null;

    try {
      const key = `user:${userId}:shared`;
      const results = await this.redis.zrevrange(key, 0, -1);

      if (!results || results.length === 0) {
        return null;
      }

      return results.map((item) => JSON.parse(item) as ShareEntity);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to get shared-with-me from cache');
      return null;
    }
  }

  /**
   * Populate the shared-with-me sorted set using pipelining.
   * Score is the sharedAt timestamp (epoch ms).
   */
  async setSharedWithMe(userId: string, shares: ShareEntity[]): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const key = `user:${userId}:shared`;
      const pipeline = this.redis.pipeline();

      // Clear existing set
      pipeline.del(key);

      // Add all shares with sharedAt as score
      for (const share of shares) {
        const score = new Date(share.sharedAt).getTime();
        pipeline.zadd(key, score.toString(), JSON.stringify(share));
      }

      // Set TTL
      pipeline.expire(key, CACHE_TTL.sharedWithMe);

      await pipeline.exec();
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to set shared-with-me in cache');
    }
  }

  // ─── File Metadata (String/JSON, TTL 10min) ──────────────────────────────

  /**
   * Get file metadata from cache.
   * Returns null on cache miss or Redis error.
   */
  async getFileMetadata(fileId: string): Promise<FileEntity | null> {
    if (!this.isAvailable()) return null;

    try {
      const key = `file:${fileId}:meta`;
      const result = await this.redis.get(key);

      if (!result) {
        return null;
      }

      return JSON.parse(result) as FileEntity;
    } catch (err) {
      logger.warn({ err, fileId }, 'Failed to get file metadata from cache');
      return null;
    }
  }

  /**
   * Cache file metadata as a JSON string.
   */
  async setFileMetadata(fileId: string, metadata: FileEntity): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const key = `file:${fileId}:meta`;
      await this.redis.set(key, JSON.stringify(metadata), 'EX', CACHE_TTL.fileMetadata);
    } catch (err) {
      logger.warn({ err, fileId }, 'Failed to set file metadata in cache');
    }
  }

  // ─── Folder Contents (Hash, TTL 10min) ───────────────────────────────────

  /**
   * Get folder contents from cache hash.
   * Returns null on cache miss or Redis error.
   */
  async getFolderContents(userId: string, folderId: string): Promise<Record<string, string> | null> {
    if (!this.isAvailable()) return null;

    try {
      const key = `user:${userId}:folders:${folderId}`;
      const result = await this.redis.hgetall(key);

      if (!result || Object.keys(result).length === 0) {
        return null;
      }

      return result;
    } catch (err) {
      logger.warn({ err, userId, folderId }, 'Failed to get folder contents from cache');
      return null;
    }
  }

  /**
   * Cache folder contents as a Redis hash using pipelining.
   */
  async setFolderContents(userId: string, folderId: string, contents: Record<string, string>): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const key = `user:${userId}:folders:${folderId}`;
      const pipeline = this.redis.pipeline();

      // Clear existing hash
      pipeline.del(key);

      // Set all hash fields
      const entries = Object.entries(contents);
      if (entries.length > 0) {
        for (const [field, value] of entries) {
          pipeline.hset(key, field, value);
        }
      }

      // Set TTL
      pipeline.expire(key, CACHE_TTL.folderContents);

      await pipeline.exec();
    } catch (err) {
      logger.warn({ err, userId, folderId }, 'Failed to set folder contents in cache');
    }
  }

  // ─── Cache Invalidation ──────────────────────────────────────────────────

  /**
   * Invalidate all user-scoped cache keys (recent files, shared-with-me).
   */
  async invalidateUserCache(userId: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      await this.redis.del(`user:${userId}:recent`, `user:${userId}:shared`);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to invalidate user cache');
    }
  }

  /**
   * Invalidate file-scoped cache keys (metadata, shares).
   */
  async invalidateFileCache(fileId: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      await this.redis.del(`file:${fileId}:meta`, `file:${fileId}:shares`);
    } catch (err) {
      logger.warn({ err, fileId }, 'Failed to invalidate file cache');
    }
  }

  /**
   * Invalidate a specific folder's cache.
   */
  async invalidateFolderCache(userId: string, folderId: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      await this.redis.del(`user:${userId}:folders:${folderId}`);
    } catch (err) {
      logger.warn({ err, userId, folderId }, 'Failed to invalidate folder cache');
    }
  }
}
