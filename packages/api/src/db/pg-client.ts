/**
 * PostgreSQL Client Configuration
 *
 * Provides connection pools for the primary RDS instance and read replica.
 * Used by AuditService for compliance-grade audit logging.
 *
 * Environment variables:
 * - RDS_HOST: Primary RDS endpoint
 * - RDS_PORT: RDS port (default 5432)
 * - RDS_DATABASE: Database name
 * - RDS_USERNAME: Database username
 * - RDS_PASSWORD: Database password
 * - RDS_READ_REPLICA_HOST: Read replica endpoint (falls back to primary)
 */

import { Pool, PoolConfig } from 'pg';
import pino from 'pino';

const logger = pino({ name: 'pg-client' });

// ─── Configuration ──────────────────────────────────────────────────────────

function buildPoolConfig(host: string): PoolConfig {
  return {
    host,
    port: parseInt(process.env.RDS_PORT || '5432', 10),
    database: process.env.RDS_DATABASE || 'vaultstream',
    user: process.env.RDS_USERNAME || 'vaultstream',
    password: process.env.RDS_PASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.RDS_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
}

// ─── Pool Singletons ────────────────────────────────────────────────────────

let primaryPool: Pool | null = null;
let replicaPool: Pool | null = null;

/**
 * Get the primary (write) connection pool.
 */
export function getPrimaryPool(): Pool {
  if (!primaryPool) {
    const host = process.env.RDS_HOST || 'localhost';
    primaryPool = new Pool(buildPoolConfig(host));

    primaryPool.on('error', (err) => {
      logger.error({ err: err.message }, 'Primary pool unexpected error');
    });

    logger.info({ host }, 'Primary PostgreSQL pool created');
  }
  return primaryPool;
}

/**
 * Get the read replica connection pool.
 * Falls back to primary if no replica host is configured.
 */
export function getReplicaPool(): Pool {
  if (!replicaPool) {
    const host = process.env.RDS_READ_REPLICA_HOST || process.env.RDS_HOST || 'localhost';
    replicaPool = new Pool(buildPoolConfig(host));

    replicaPool.on('error', (err) => {
      logger.error({ err: err.message }, 'Replica pool unexpected error');
    });

    logger.info({ host }, 'Replica PostgreSQL pool created');
  }
  return replicaPool;
}

/**
 * Disconnect all pools. Used for graceful shutdown and testing.
 */
export async function disconnectPools(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (primaryPool) {
    promises.push(primaryPool.end());
    primaryPool = null;
  }

  if (replicaPool) {
    promises.push(replicaPool.end());
    replicaPool = null;
  }

  await Promise.all(promises);
  logger.info('PostgreSQL pools disconnected');
}

/**
 * Reset pool instances (for testing).
 */
export function resetPools(): void {
  primaryPool = null;
  replicaPool = null;
}
