/**
 * Redis Client Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRedisOptions, createRedisClient, getRedisClient, disconnectRedis, resetRedisInstance } from './redis-client.js';

describe('buildRedisOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default options when no env vars are set', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_TLS_ENABLED;

    const opts = buildRedisOptions();

    expect(opts.host).toBe('localhost');
    expect(opts.port).toBe(6379);
    expect(opts.password).toBeUndefined();
    expect(opts.tlsEnabled).toBe(false);
  });

  it('should read host and port from env vars', () => {
    process.env.REDIS_HOST = 'my-redis.cluster.cache.amazonaws.com';
    process.env.REDIS_PORT = '6380';

    const opts = buildRedisOptions();

    expect(opts.host).toBe('my-redis.cluster.cache.amazonaws.com');
    expect(opts.port).toBe(6380);
  });

  it('should read password from env var', () => {
    process.env.REDIS_PASSWORD = 'super-secret-token';

    const opts = buildRedisOptions();

    expect(opts.password).toBe('super-secret-token');
  });

  it('should enable TLS when REDIS_TLS_ENABLED is true', () => {
    process.env.REDIS_TLS_ENABLED = 'true';

    const opts = buildRedisOptions();

    expect(opts.tlsEnabled).toBe(true);
  });

  it('should not enable TLS when REDIS_TLS_ENABLED is not true', () => {
    process.env.REDIS_TLS_ENABLED = 'false';

    const opts = buildRedisOptions();

    expect(opts.tlsEnabled).toBe(false);
  });

  it('should use custom connect timeout from env', () => {
    process.env.REDIS_CONNECT_TIMEOUT = '10000';

    const opts = buildRedisOptions();

    expect(opts.connectTimeout).toBe(10000);
  });
});

describe('createRedisClient', () => {
  it('should create a Redis client with basic options', () => {
    const client = createRedisClient({
      host: 'localhost',
      port: 6379,
      lazyConnect: true,
    });

    expect(client).toBeDefined();
    expect(client.options.host).toBe('localhost');
    expect(client.options.port).toBe(6379);

    // Cleanup
    client.disconnect();
  });

  it('should create a Redis client with TLS enabled', () => {
    const client = createRedisClient({
      host: 'redis.example.com',
      port: 6380,
      tlsEnabled: true,
      lazyConnect: true,
    });

    expect(client).toBeDefined();
    expect(client.options.tls).toBeDefined();

    // Cleanup
    client.disconnect();
  });

  it('should create a Redis client with password', () => {
    const client = createRedisClient({
      host: 'localhost',
      port: 6379,
      password: 'my-auth-token',
      lazyConnect: true,
    });

    expect(client).toBeDefined();
    expect(client.options.password).toBe('my-auth-token');

    // Cleanup
    client.disconnect();
  });

  it('should not set TLS when tlsEnabled is false', () => {
    const client = createRedisClient({
      host: 'localhost',
      port: 6379,
      tlsEnabled: false,
      lazyConnect: true,
    });

    expect(client.options.tls).toBeUndefined();

    // Cleanup
    client.disconnect();
  });
});

describe('getRedisClient / disconnectRedis', () => {
  afterEach(async () => {
    resetRedisInstance();
  });

  it('should return the same instance on multiple calls', () => {
    const client1 = getRedisClient();
    const client2 = getRedisClient();

    expect(client1).toBe(client2);

    // Cleanup
    client1.disconnect();
  });
});
