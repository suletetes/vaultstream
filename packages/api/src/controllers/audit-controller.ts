/**
 * AuditController — Express route handlers for audit log endpoints.
 *
 * Handles:
 * - queryAuditLog: Paginated audit event query (read replica)
 * - exportCsv: Export audit events as CSV download
 *
 * Requirements: 15.6, 15.8
 */

import { Request, Response, NextFunction } from 'express';
import { getAuditService } from '../services/audit-service';

/**
 * GET /api/audit
 *
 * Query audit events for the authenticated user.
 * Supports filtering by eventType, fileId, startDate, endDate.
 * Paginated with page/limit query params.
 */
export async function queryAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const {
      eventType,
      fileId,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    const auditService = getAuditService();
    const result = await auditService.queryEvents({
      userId,
      eventType: eventType as string | undefined,
      fileId: fileId as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/audit/export
 *
 * Export audit events as CSV for the authenticated user.
 * Supports same filters as queryAuditLog.
 */
export async function exportAuditCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { eventType, fileId, startDate, endDate } = req.query;

    const auditService = getAuditService();
    const csv = await auditService.exportCsv({
      userId,
      eventType: eventType as string | undefined,
      fileId: fileId as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}
