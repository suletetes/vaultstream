/**
 * Audit Logger Middleware
 *
 * Runs AFTER route handlers (using res.on('finish')) to log completed
 * requests to the AuditService. Fire-and-forget — never blocks responses.
 *
 * Captures: event_type, severity, userId, fileId, action, IP, user agent,
 * requestId, duration_ms, status_code.
 *
 * Requirements: 15.1, 15.2
 */

import { Request, Response, NextFunction } from 'express';
import { getAuditService, AuditEvent } from '../services/audit-service';

/**
 * Derive event type from HTTP method + path.
 */
function deriveEventType(method: string, path: string): string {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.toLowerCase();

  // File operations
  if (normalizedPath.includes('/files/upload-url')) return 'file.upload_url';
  if (normalizedPath.includes('/files/upload-complete')) return 'file.upload_complete';
  if (normalizedPath.includes('/download-url')) return 'file.downloaded';
  if (normalizedPath.includes('/preview-url')) return 'file.previewed';
  if (normalizedPath.includes('/versions') && normalizedPath.includes('/restore')) return 'file.version_restored';
  if (normalizedPath.includes('/versions')) return 'file.versions_listed';
  if (normalizedPath.includes('/restore')) return 'file.restored';
  if (normalizedPath.includes('/move')) return 'file.moved';
  if (normalizedPath.includes('/share')) return 'file.shared';
  if (normalizedPath.includes('/shares') && normalizedMethod === 'DELETE') return 'file.share_revoked';

  // Folder operations
  if (normalizedPath.includes('/folders')) {
    if (normalizedMethod === 'POST') return 'folder.created';
    if (normalizedMethod === 'PUT') return 'folder.renamed';
    if (normalizedMethod === 'DELETE') return 'folder.deleted';
    return 'folder.listed';
  }

  // File CRUD
  if (normalizedPath.includes('/files')) {
    if (normalizedMethod === 'POST') return 'file.created';
    if (normalizedMethod === 'PUT') return 'file.updated';
    if (normalizedMethod === 'DELETE') return 'file.deleted';
    if (normalizedMethod === 'GET') return 'file.accessed';
  }

  // Audit
  if (normalizedPath.includes('/audit')) return 'audit.queried';

  // Search
  if (normalizedPath.includes('/search')) return 'search.executed';

  // Bulk
  if (normalizedPath.includes('/bulk')) return 'bulk.operation';

  // Admin
  if (normalizedPath.includes('/admin')) return 'admin.action';

  // Default
  return `${normalizedMethod.toLowerCase()}.${normalizedPath.split('/').filter(Boolean).slice(1, 3).join('_') || 'unknown'}`;
}

/**
 * Derive severity from status code.
 */
function deriveSeverity(statusCode: number): 'info' | 'warning' | 'critical' {
  if (statusCode >= 500) return 'critical';
  if (statusCode >= 400) return 'warning';
  return 'info';
}

/**
 * Derive action from HTTP method.
 */
function deriveAction(method: string): string {
  const map: Record<string, string> = {
    GET: 'read',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
  };
  return map[method.toUpperCase()] || 'unknown';
}

/**
 * Extract fileId from request params or path.
 */
function extractFileId(req: Request): string | undefined {
  // Check route params
  if (req.params?.id) return req.params.id;
  if (req.params?.fileId) return req.params.fileId;

  // Try to extract from path
  const fileMatch = req.originalUrl.match(/\/files\/([a-zA-Z0-9]+)/);
  if (fileMatch) return fileMatch[1];

  return undefined;
}

/**
 * Extract client IP address from request.
 */
function extractIpAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Derive resource type from path.
 */
function deriveResourceType(path: string): 'file' | 'folder' | 'share' | 'user' | undefined {
  if (path.includes('/files') || path.includes('/upload')) return 'file';
  if (path.includes('/folders')) return 'folder';
  if (path.includes('/share')) return 'share';
  if (path.includes('/admin/users') || path.includes('/stats')) return 'user';
  return undefined;
}

/**
 * Audit logger middleware factory.
 * Attaches a 'finish' event listener to log completed requests.
 */
export function auditLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      // Skip health checks and static assets
      if (req.path === '/health' || req.path.startsWith('/static')) {
        return;
      }

      // Skip if no userId (unauthenticated requests)
      const userId = (req as Record<string, unknown>).userId as string | undefined;
      if (!userId) {
        return;
      }

      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      const event: AuditEvent = {
        eventType: deriveEventType(req.method, req.originalUrl || req.path),
        severity: deriveSeverity(statusCode),
        userId,
        fileId: extractFileId(req),
        resourceType: deriveResourceType(req.originalUrl || req.path),
        action: deriveAction(req.method),
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || undefined,
        requestId: req.requestId || undefined,
        durationMs,
        statusCode,
      };

      // Fire-and-forget — don't await, catch errors silently
      try {
        getAuditService().logEvent(event);
      } catch {
        // Silently ignore — audit failures must never affect user operations
      }
    });

    next();
  };
}
