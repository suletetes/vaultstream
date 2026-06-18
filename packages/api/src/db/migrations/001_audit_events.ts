/**
 * Migration 001: Create audit_events table
 *
 * Creates a partitioned audit_events table for compliance-grade audit logging.
 * - Range-partitioned by created_at (monthly)
 * - Indexes on user_id, file_id, event_type, created_at
 * - REVOKE DELETE to ensure immutability
 *
 * Runs against the primary RDS pool via node-postgres (`pg`), consistent with
 * the rest of the data layer (see db/pg-client.ts).
 */

import type { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Create the audit_events table with range partitioning by created_at
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID DEFAULT gen_random_uuid(),
      event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'info',
      user_id VARCHAR(128),
      file_id VARCHAR(128),
      action VARCHAR(255) NOT NULL,
      resource_type VARCHAR(50),
      resource_id VARCHAR(128),
      ip_address INET,
      user_agent TEXT,
      request_id VARCHAR(128),
      duration_ms INTEGER,
      status_code INTEGER,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);
  `);

  // Create indexes for common query patterns
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_user_id
      ON audit_events (user_id, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_file_id
      ON audit_events (file_id, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_event_type
      ON audit_events (event_type, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
      ON audit_events (created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_severity
      ON audit_events (severity, created_at DESC);
  `);

  // REVOKE DELETE to ensure audit log immutability
  await client.query(`
    REVOKE DELETE ON audit_events FROM PUBLIC;
  `);

  // Create initial partition for current month
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const nextMonth = now.getMonth() + 2 > 12
    ? `${year + 1}-01`
    : `${year}-${String(now.getMonth() + 2).padStart(2, '0')}`;

  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_events_${year}_${month}
      PARTITION OF audit_events
      FOR VALUES FROM ('${year}-${month}-01') TO ('${nextMonth}-01');
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query('DROP TABLE IF EXISTS audit_events CASCADE;');
}
