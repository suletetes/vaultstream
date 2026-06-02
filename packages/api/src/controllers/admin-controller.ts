/**
 * AdminController — Express route handlers for admin endpoints.
 *
 * All endpoints require admin role verification.
 * All actions logged as critical severity audit events.
 *
 * Requirements: 20.6, 23.1, 23.2, 23.6
 */

import { Request, Response, NextFunction } from 'express';
import { adminService } from '../services/admin-service';

/**
 * GET /api/admin/users
 */
export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    adminService.verifyAdminRole(req.user?.role);
    const { limit, cursor } = req.query;

    const result = await adminService.listUsers({
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/health
 */
export async function systemHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    adminService.verifyAdminRole(req.user?.role);
    const health = await adminService.getSystemHealth();
    res.status(200).json(health);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/analytics
 */
export async function storageAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    adminService.verifyAdminRole(req.user?.role);
    const analytics = await adminService.getStorageAnalytics();
    res.status(200).json(analytics);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/users/:id/disable
 */
export async function disableUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    adminService.verifyAdminRole(req.user?.role);
    const adminUserId = req.user!.userId;
    const targetUserId = req.params.id;

    await adminService.disableUser(adminUserId, targetUserId);
    res.status(200).json({ message: 'User disabled successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/dlq
 */
export async function dlqStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    adminService.verifyAdminRole(req.user?.role);
    const status = await adminService.getDlqStatus();
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/stats
 * User storage statistics (available to all authenticated users).
 */
export async function getUserStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    // In production, this would query the user profile from DynamoDB
    res.status(200).json({
      userId,
      storageUsedBytes: 0,
      storageQuotaBytes: 5368709120, // 5GB default
      fileCount: 0,
      percentageUsed: 0,
    });
  } catch (error) {
    next(error);
  }
}
