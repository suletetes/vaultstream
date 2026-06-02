/**
 * Audit Routes — Express Router for audit log endpoints.
 *
 * Routes:
 * - GET /api/audit → Query audit events (paginated, filtered)
 * - GET /api/audit/export → Export audit events as CSV
 *
 * Requirements: 15.6, 15.8
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { queryAuditLog, exportAuditCsv } from '../controllers/audit-controller';

const router = Router();

// GET /api/audit — Query audit events
router.get('/api/audit', cognitoAuth(), queryAuditLog);

// GET /api/audit/export — Export audit events as CSV
router.get('/api/audit/export', cognitoAuth(), exportAuditCsv);

export { router as auditRoutes };
