/**
 * Unit tests for ShareController route handlers.
 *
 * Tests file sharing operations using Supertest against the Express app
 * with mocked services and authentication.
 *
 * Validates: Requirements 4.1, 4.6, 4.7, 4.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { correlationId } from '../middleware/correlation-id';
import { validate } from '../middleware/validation';
import { errorHandler } from '../middleware/error-handler';
import { createShareSchema, updateShareSchema } from '@vaultstream/shared';
import { createShare, listShares, updateShare, revokeShare, sharedWithMe } from './share-controller';

// ─── Mock the share service ─────────────────────────────────────────────────

vi.mock('../services/share-service', () => ({
  shareService: {
    createShare: vi.fn(),
    listSharesForFile: vi.fn(),
    updatePermissions: vi.fn(),
    revokeShare: vi.fn(),
    getSharedWithMe: vi.fn(),
  },
}));

import { shareService } from '../services/share-service';

const mockShareService = shareService as unknown as {
  createShare: ReturnType<typeof vi.fn>;
  listSharesForFile: ReturnType<typeof vi.fn>;
  updatePermissions: ReturnType<typeof vi.fn>;
  revokeShare: ReturnType<typeof vi.fn>;
  getSharedWithMe: ReturnType<typeof vi.fn>;
};

// ─── Test App Setup ─────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(correlationId());
  app.use(express.json());

  const mockAuth = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.user = { userId: 'user-123', email: 'owner@example.com', role: 'user' };
    next();
  };

  // POST /api/files/:id/share
  app.post(
    '/api/files/:id/share',
    mockAuth,
    validate({ body: createShareSchema }),
    createShare,
  );

  // GET /api/files/:id/shares
  app.get('/api/files/:id/shares', mockAuth, listShares);

  // PUT /api/files/:id/shares/:userId
  app.put(
    '/api/files/:id/shares/:userId',
    mockAuth,
    validate({ body: updateShareSchema }),
    updateShare,
  );

  // DELETE /api/files/:id/shares/:userId
  app.delete('/api/files/:id/shares/:userId', mockAuth, revokeShare);

  // GET /api/shared
  app.get('/api/shared', mockAuth, sharedWithMe);

  app.use(errorHandler());

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ShareController', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/files/:id/share', () => {
    const validBody = {
      targetUserEmail: 'recipient@example.com',
      permissions: 'view',
    };

    it('should return 201 with created share on valid request', async () => {
      const mockShare = {
        fileId: 'file-abc',
        sharedBy: 'user-123',
        sharedWith: 'user-456',
        permissions: 'view',
        sharedAt: '2024-01-01T00:00:00.000Z',
      };

      mockShareService.createShare.mockResolvedValue(mockShare);

      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockShare);
      expect(mockShareService.createShare).toHaveBeenCalledWith({
        ownerId: 'user-123',
        fileId: 'file-abc',
        targetEmail: 'recipient@example.com',
        permissions: 'view',
        expiresInHours: undefined,
        message: undefined,
      });
    });

    it('should pass optional expiresInHours and message', async () => {
      mockShareService.createShare.mockResolvedValue({ fileId: 'file-abc' });

      const bodyWithOptionals = {
        ...validBody,
        expiresInHours: 24,
        message: 'Please review this document',
      };

      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send(bodyWithOptionals);

      expect(res.status).toBe(201);
      expect(mockShareService.createShare).toHaveBeenCalledWith({
        ownerId: 'user-123',
        fileId: 'file-abc',
        targetEmail: 'recipient@example.com',
        permissions: 'view',
        expiresInHours: 24,
        message: 'Please review this document',
      });
    });

    it('should return 400 when targetUserEmail is missing', async () => {
      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send({ permissions: 'view' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when targetUserEmail is invalid', async () => {
      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send({ targetUserEmail: 'not-an-email', permissions: 'view' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when permissions is invalid', async () => {
      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send({ targetUserEmail: 'user@example.com', permissions: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockShareService.createShare.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Cannot share a file with yourself' }),
      );

      const res = await request(app)
        .post('/api/files/file-abc/share')
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Cannot share a file with yourself');
    });
  });

  describe('GET /api/files/:id/shares', () => {
    it('should return 200 with list of shares', async () => {
      const mockShares = [
        { sharedWith: 'user-456', permissions: 'view', sharedAt: '2024-01-01T00:00:00.000Z' },
        { sharedWith: 'user-789', permissions: 'edit', sharedAt: '2024-01-02T00:00:00.000Z' },
      ];

      mockShareService.listSharesForFile.mockResolvedValue(mockShares);

      const res = await request(app).get('/api/files/file-abc/shares');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockShares);
      expect(mockShareService.listSharesForFile).toHaveBeenCalledWith({ fileId: 'file-abc', ownerId: 'user-123' });
    });

    it('should return 200 with empty array when no shares exist', async () => {
      mockShareService.listSharesForFile.mockResolvedValue([]);

      const res = await request(app).get('/api/files/file-abc/shares');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PUT /api/files/:id/shares/:userId', () => {
    it('should return 200 on successful permission update', async () => {
      mockShareService.updatePermissions.mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/files/file-abc/shares/user-456')
        .send({ permissions: 'edit' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Share permissions updated');
      expect(mockShareService.updatePermissions).toHaveBeenCalledWith({
        ownerId: 'user-123',
        fileId: 'file-abc',
        targetUserId: 'user-456',
        permissions: 'edit',
      });
    });

    it('should return 400 when permissions is missing', async () => {
      const res = await request(app)
        .put('/api/files/file-abc/shares/user-456')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when permissions is invalid', async () => {
      const res = await request(app)
        .put('/api/files/file-abc/shares/user-456')
        .send({ permissions: 'superadmin' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/files/:id/shares/:userId', () => {
    it('should return 204 on successful share revocation', async () => {
      mockShareService.revokeShare.mockResolvedValue(undefined);

      const res = await request(app).delete('/api/files/file-abc/shares/user-456');

      expect(res.status).toBe(204);
      expect(mockShareService.revokeShare).toHaveBeenCalledWith({
        ownerId: 'user-123',
        fileId: 'file-abc',
        targetUserId: 'user-456',
      });
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockShareService.revokeShare.mockRejectedValue(
        new AppError({ code: ErrorCode.INTERNAL_ERROR, message: 'Database error' }),
      );

      const res = await request(app).delete('/api/files/file-abc/shares/user-456');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/shared', () => {
    it('should return 200 with shared-with-me results', async () => {
      const mockResult = {
        items: [
          { fileId: 'file-1', sharedBy: 'user-999', permissions: 'view' },
          { fileId: 'file-2', sharedBy: 'user-888', permissions: 'download' },
        ],
        hasMore: false,
      };

      mockShareService.getSharedWithMe.mockResolvedValue(mockResult);

      const res = await request(app).get('/api/shared');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockShareService.getSharedWithMe).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { cursor: undefined, limit: undefined },
      });
    });

    it('should pass pagination params from query string', async () => {
      mockShareService.getSharedWithMe.mockResolvedValue({ items: [], hasMore: false });

      const res = await request(app).get('/api/shared?cursor=xyz&limit=5');

      expect(res.status).toBe(200);
      expect(mockShareService.getSharedWithMe).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { cursor: 'xyz', limit: 5 },
      });
    });

    it('should return 200 with empty results when nothing is shared', async () => {
      mockShareService.getSharedWithMe.mockResolvedValue({ items: [], hasMore: false });

      const res = await request(app).get('/api/shared');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.hasMore).toBe(false);
    });
  });
});
