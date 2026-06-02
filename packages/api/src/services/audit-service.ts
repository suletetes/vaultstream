/**
 * AuditService — Compliance-grade audit logging
 *
 * - logEvent(): Fire-and-forget INSERT into audit_events via pg Pool.
 *   Never blocks user operations.
 * - queryEvents(): Query with filters using read replica. Paginated.
 * - exportCsv(): Same query but returns CSV string.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8
 */

import { Pool } from 'pg';
import { getPrimaryPool, getReplicaPool } from '../db/pg-client';
import pino from 'pino';

const logger = pino({ name: 'audit-service' });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditEvent {
  eventType: string;
  severity?: 'info' | 'warning' | 'critical';
  userId?: string;
  fileId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  durationMs?: number;
  statusCode?: number;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryParams {
  userId?: string;
  fileId?: string;
  eventType?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface AuditQueryResult {
  events: AuditEventRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditEventRecord {
  id: string;
  eventType: string;
  severity: string;
  userId: string | null;
  fileId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  durationMs: number | null;
  statusCode: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class AuditService {
  private writePool: Pool;
  private readPool: Pool;

  constructor(writePool?: Pool, readPool?: Pool) {
    this.writePool = writePool ?? getPrimaryPool();
    this.readPool = readPool ?? getReplicaPool();
  }

  /**
   * Fire-and-forget INSERT into audit_events.
   * Never blocks user operations — errors are logged but not thrown.
   */
  logEvent(event: AuditEvent): void {
    const query = `
      INSERT INTO audit_events (
        event_type, severity, user_id, file_id, action,
        resource_type, resource_id, ip_address, user_agent,
        request_id, duration_ms, status_code, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    const values = [
      event.eventType,
      event.severity || 'info',
      event.userId || null,
      event.fileId || null,
      event.action,
      event.resourceType || null,
      event.resourceId || null,
      event.ipAddress || null,
      event.userAgent || null,
      event.requestId || null,
      event.durationMs ?? null,
      event.statusCode ?? null,
      JSON.stringify(event.metadata || {}),
    ];

    // Fire-and-forget: do not await
    this.writePool.query(query, values).catch((err) => {
      logger.error({ err: err.message, event: event.eventType }, 'Failed to log audit event');
    });
  }

  /**
   * Query audit events with filters using the read replica.
   * Supports pagination.
   */
  async queryEvents(params: AuditQueryParams): Promise<AuditQueryResult> {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = (page - 1) * limit;

    const { whereClause, values } = this.buildWhereClause(params);

    // Count total matching records
    const countQuery = `SELECT COUNT(*) as total FROM audit_events ${whereClause}`;
    const countResult = await this.readPool.query(countQuery, values);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch paginated results
    const dataQuery = `
      SELECT id, event_type, severity, user_id, file_id, action,
             resource_type, resource_id, ip_address, user_agent,
             request_id, duration_ms, status_code, metadata, created_at
      FROM audit_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const dataResult = await this.readPool.query(dataQuery, [...values, limit, offset]);

    const events: AuditEventRecord[] = dataResult.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      userId: row.user_id,
      fileId: row.file_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      requestId: row.request_id,
      durationMs: row.duration_ms,
      statusCode: row.status_code,
      metadata: row.metadata || {},
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    }));

    return {
      events,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Export audit events as CSV string.
   * Same query as queryEvents but returns all matching records as CSV.
   */
  async exportCsv(params: AuditQueryParams): Promise<string> {
    const { whereClause, values } = this.buildWhereClause(params);

    const query = `
      SELECT id, event_type, severity, user_id, file_id, action,
             resource_type, resource_id, ip_address, user_agent,
             request_id, duration_ms, status_code, created_at
      FROM audit_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 10000
    `;

    const result = await this.readPool.query(query, values);

    // Build CSV
    const headers = [
      'id', 'event_type', 'severity', 'user_id', 'file_id', 'action',
      'resource_type', 'resource_id', 'ip_address', 'user_agent',
      'request_id', 'duration_ms', 'status_code', 'created_at',
    ];

    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      const csvRow = headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape CSV values containing commas, quotes, or newlines
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(csvRow.join(','));
    }

    return csvRows.join('\n');
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildWhereClause(params: AuditQueryParams): { whereClause: string; values: unknown[] } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(params.userId);
    }

    if (params.fileId) {
      conditions.push(`file_id = $${paramIndex++}`);
      values.push(params.fileId);
    }

    if (params.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      values.push(params.eventType);
    }

    if (params.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(params.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, values };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let auditServiceInstance: AuditService | null = null;

export function getAuditService(): AuditService {
  if (!auditServiceInstance) {
    auditServiceInstance = new AuditService();
  }
  return auditServiceInstance;
}

export function resetAuditService(): void {
  auditServiceInstance = null;
}
