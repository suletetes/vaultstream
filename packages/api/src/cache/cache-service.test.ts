/**
 * CacheService Unit Tests
 *
 * Uses ioredis mock to test cache operations without a real Redis connection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Redis from 'ioredis';
import { RedisCacheService } from './cache-service.js';
import type { FileEntity, ShareEntity } from '@vaultstream/shared';

// Use ioredis built-in mock support via manual mock
vi.mock('ioredis', () => {
  const RedisMock = vi.fn(() => {
    const store = new Map<string, string>();
    const sortedSets = new Map<string, Map<string, number>>();
    const hashes = new Map<string, Map<string, string>>();
    const ttls = new Map<string, number>();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    const instance = {
      status: 'ready',
      store,
      sortedSets,
      hashes,
      ttls,
      on(event: string, cb: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
        // Immediately fire 'ready' if status is ready
        if (event === 'ready' && instance.status === 'ready') {
          cb();
        }
        return instance;
      },
      emit(event: string, ...args: unknown[]) {
        const cbs = listeners.get(event) || [];
        for (const cb of cbs) cb(...args);
      },
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, _mode?: string, _ttl?: number) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const key of keys) {
          if (store.has(key) || sortedSets.has(key) || hashes.has(key)) count++;
          store.delete(key);
          sortedSets.delete(key);
          hashes.delete(key);
        }
        return count;
      }),
      zadd: vi.fn(async (key: string, score: string, member: string) => {
        if (!sortedSets.has(key)) sortedSets.set(key, new Map());
        sortedSets.get(key)!.set(member, parseFloat(score));
        return 1;
      }),
      zrevrange: vi.fn(async (key: string, _start: number, _stop: number) => {
        const set = sortedSets.get(key);
        if (!set || set.size === 0) return [];
        // Sort by score descending
        const entries = [...set.entries()].sort((a, b) => b[1] - a[1]);
        return entries.map(([member]) => member);
      }),
      hgetall: vi.fn(async (key: string) => {
        const hash = hashes.get(key);
        if (!hash || hash.size === 0) return {};
        return Object.fromEntries(hash.entries());
      }),
      hset: vi.fn(async (key: string, field: string, value: string) => {
        if (!hashes.has(key)) hashes.set(key, new Map());
        hashes.get(key)!.set(field, value);
        return 1;
      }),
      expire: vi.fn(async (key: string, seconds: number) => {
        ttls.set(key, seconds);
        return 1;
      }),
      pipeline: vi.fn(() => {
        const commands: Array<{ method: string; args: unknown[] }> = [];
        const pipe = {
          del(...keys: string[]) {
            commands.push({ method: 'del', args: keys });
            return pipe;
          },
          zadd(key: string, score: string, member: string) {
            commands.push({ method: 'zadd', args: [key, score, member] });
            return pipe;
          },
          hset(key: string, field: string, value: string) {
            commands.push({ method: 'hset', args: [key, field, value] });
            return pipe;
          },
          expire(key: string, seconds: number) {
            commands.push({ method: 'expire', args: [key, seconds] });
            return pipe;
          },
          async exec() {
            const results: Array<[Error | null, unknown]> = [];
            for (const cmd of commands) {
              try {
                const method = cmd.method as keyof typeof instance;
                const fn = instance[method] as (...args: unknown[]) => Promise<unknown>;
                const result = await fn(...cmd.args);
                results.push([null, result]);
              } catch (err) {
                results.push([err as Error, null]);
              }
            }
            return results;
          },
        };
        return pipe;
      }),
      disconnect: vi.fn(),
      quit: vi.fn(async () => 'OK'),
    };

    return instance;
  });

  return { default: RedisMock };
});

function createMockFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    PK: 'USER#user-123',
    SK: 'FILE#file-abc',
    entityType: 'FILE',
    fileId: 'file-abc',
    filename: 'test-document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024000,
    s3Key: 'users/user-123/files/file-abc/1/test-document.pdf',
    s3VersionId: 'v1',
    encryptedDataKey: 'base64-encrypted-dek',
    kmsKeyId: 'arn:aws:kms:us-east-1:123456789:key/abc',
    thumbnailKey: null,
    folderId: 'ROOT',
    tags: ['important'],
    storageClass: 'STANDARD',
    virusScanStatus: 'clean',
    version: 1,
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastAccessedAt: '2024-01-15T10:30:00.000Z',
    GSI1PK: 'USER#user-123',
    GSI1SK: '2024-01-15T10:30:00.000Z',
    GSI2PK: 'FOLDER#ROOT',
    GSI2SK: 'test-document.pdf',
    ...overrides,
  };
}

function createMockShare(overrides: Partial<ShareEntity> = {}): ShareEntity {
  return {
    PK: 'FILE#file-abc',
    SK: 'SHARE#user-456',
    entityType: 'SHARE',
    fileId: 'file-abc',
    sharedBy: 'user-123',
    sharedWith: 'user-456',
    permissions: 'download',
    sharedAt: '2024-01-10T08:00:00.000Z',
    GSI3PK: 'USER#user-456',
    GSI3SK: '2024-01-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('RedisCacheService', () => {
  let redis: InstanceType<typeof Redis>;
  let cacheService: RedisCacheService;

  beforeEach(() => {
    redis = new Redis();
    cacheService = new RedisCacheService(redis);
  });

  describe('isAvailable', () => {
    it('should return true when Redis status is ready', () => {
      expect(cacheService.isAvailable()).toBe(true);
    });

    it('should return false when Redis emits error', () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('Connection refused'));
      expect(cacheService.isAvailable()).toBe(false);
    });

    it('should return false when Redis emits close', () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      expect(cacheService.isAvailable()).toBe(false);
    });
  });

  describe('getRecentFiles / setRecentFiles', () => {
    it('should return null on cache miss', async () => {
      const result = await cacheService.getRecentFiles('user-123');
      expect(result).toBeNull();
    });

    it('should store and retrieve recent files', async () => {
      const files = [
        createMockFile({ fileId: 'file-1', lastAccessedAt: '2024-01-15T10:00:00.000Z' }),
        createMockFile({ fileId: 'file-2', lastAccessedAt: '2024-01-15T09:00:00.000Z' }),
      ];

      await cacheService.setRecentFiles('user-123', files);
      const result = await cacheService.getRecentFiles('user-123');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      // Should be sorted by lastAccessedAt descending
      expect(result![0].fileId).toBe('file-1');
      expect(result![1].fileId).toBe('file-2');
    });

    it('should return null when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      const result = await cacheService.getRecentFiles('user-123');
      expect(result).toBeNull();
    });
  });

  describe('getSharedWithMe / setSharedWithMe', () => {
    it('should return null on cache miss', async () => {
      const result = await cacheService.getSharedWithMe('user-456');
      expect(result).toBeNull();
    });

    it('should store and retrieve shared items', async () => {
      const shares = [
        createMockShare({ sharedAt: '2024-01-12T08:00:00.000Z' }),
        createMockShare({ fileId: 'file-xyz', sharedAt: '2024-01-10T08:00:00.000Z' }),
      ];

      await cacheService.setSharedWithMe('user-456', shares);
      const result = await cacheService.getSharedWithMe('user-456');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
    });

    it('should return null when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      const result = await cacheService.getSharedWithMe('user-456');
      expect(result).toBeNull();
    });
  });

  describe('getFileMetadata / setFileMetadata', () => {
    it('should return null on cache miss', async () => {
      const result = await cacheService.getFileMetadata('file-abc');
      expect(result).toBeNull();
    });

    it('should store and retrieve file metadata', async () => {
      const file = createMockFile();

      await cacheService.setFileMetadata('file-abc', file);
      const result = await cacheService.getFileMetadata('file-abc');

      expect(result).not.toBeNull();
      expect(result!.fileId).toBe('file-abc');
      expect(result!.filename).toBe('test-document.pdf');
    });

    it('should return null when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      const result = await cacheService.getFileMetadata('file-abc');
      expect(result).toBeNull();
    });
  });

  describe('getFolderContents / setFolderContents', () => {
    it('should return null on cache miss', async () => {
      const result = await cacheService.getFolderContents('user-123', 'folder-1');
      expect(result).toBeNull();
    });

    it('should store and retrieve folder contents', async () => {
      const contents = {
        'file-1': JSON.stringify({ fileId: 'file-1', filename: 'doc.pdf' }),
        'file-2': JSON.stringify({ fileId: 'file-2', filename: 'img.png' }),
      };

      await cacheService.setFolderContents('user-123', 'folder-1', contents);
      const result = await cacheService.getFolderContents('user-123', 'folder-1');

      expect(result).not.toBeNull();
      expect(result!['file-1']).toBe(contents['file-1']);
      expect(result!['file-2']).toBe(contents['file-2']);
    });

    it('should return null when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      const result = await cacheService.getFolderContents('user-123', 'folder-1');
      expect(result).toBeNull();
    });
  });

  describe('invalidateUserCache', () => {
    it('should delete user recent and shared keys', async () => {
      const file = createMockFile();
      const share = createMockShare();

      await cacheService.setRecentFiles('user-123', [file]);
      await cacheService.setSharedWithMe('user-123', [share]);

      await cacheService.invalidateUserCache('user-123');

      const recentResult = await cacheService.getRecentFiles('user-123');
      const sharedResult = await cacheService.getSharedWithMe('user-123');

      expect(recentResult).toBeNull();
      expect(sharedResult).toBeNull();
    });

    it('should not throw when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      await expect(cacheService.invalidateUserCache('user-123')).resolves.toBeUndefined();
    });
  });

  describe('invalidateFileCache', () => {
    it('should delete file metadata key', async () => {
      const file = createMockFile();
      await cacheService.setFileMetadata('file-abc', file);

      await cacheService.invalidateFileCache('file-abc');

      const result = await cacheService.getFileMetadata('file-abc');
      expect(result).toBeNull();
    });

    it('should not throw when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      await expect(cacheService.invalidateFileCache('file-abc')).resolves.toBeUndefined();
    });
  });

  describe('invalidateFolderCache', () => {
    it('should delete folder contents key', async () => {
      const contents = { 'file-1': JSON.stringify({ fileId: 'file-1' }) };
      await cacheService.setFolderContents('user-123', 'folder-1', contents);

      await cacheService.invalidateFolderCache('user-123', 'folder-1');

      const result = await cacheService.getFolderContents('user-123', 'folder-1');
      expect(result).toBeNull();
    });

    it('should not throw when Redis is unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      await expect(cacheService.invalidateFolderCache('user-123', 'folder-1')).resolves.toBeUndefined();
    });
  });

  describe('graceful degradation', () => {
    it('should silently skip setRecentFiles when unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      const files = [createMockFile()];
      await expect(cacheService.setRecentFiles('user-123', files)).resolves.toBeUndefined();
    });

    it('should silently skip setSharedWithMe when unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      const shares = [createMockShare()];
      await expect(cacheService.setSharedWithMe('user-456', shares)).resolves.toBeUndefined();
    });

    it('should silently skip setFileMetadata when unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('error', new Error('fail'));
      const file = createMockFile();
      await expect(cacheService.setFileMetadata('file-abc', file)).resolves.toBeUndefined();
    });

    it('should silently skip setFolderContents when unavailable', async () => {
      (redis as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('close');
      await expect(cacheService.setFolderContents('user-123', 'folder-1', {})).resolves.toBeUndefined();
    });
  });
});
