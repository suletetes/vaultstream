/**
 * Unit tests for ViewController route handlers.
 *
 * Tests the recent files and shared-with-me routes using Supertest
 * with mocked services and authentication.
 *
 * Validates: Requirements 7.1, 7.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { correlationId } from '../middleware/correlation-id';
import { errorHandler } from '../middleware/error-handler';
import { getRecentFiles, getSharedWithMe } from './view-controller';

// ─── Mock the services ──────────────────────────────────────────────────────

vi.mock('../services/file-service', () => ({
  fileService: {
    getRecentFiles: vi.fn(),
  },
}));

vi.mock('../services/share-service', () => ({
  shareService: {
    getSharedWithMe: vi.fn(),
  },
}));

import { fileService } from '../services/file-service';
import { shareService } from '../services/share-service';

const mockFileService = fileService as unknown as {
  getRecentFiles: ReturnType<typeof vi.fn>;
};

const mockShareService = shareService as unknown as {
  getSharedWithMe: ReturnType<typeof vi.fn>;
};

// ─── Test App Setup ─────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(correlationId());
  app.use(express.json());

  // Mock cognitoAuth middleware
  const mockAuth = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    next();
  };

  app.get('/api/recent', mockAuth, getRecentFiles);
  app.get('/api/shared', mockAuth, getSharedWithMe);

  app.use(errorHandler());

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ViewController', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/recent', () => {
    it('should return 200 with recent files', async () => {
      const mockFiles = [
        { fileId: 'file-1', filename: 'recent1.pdf', lastAccessedAt: '2024-01-03T00:00:00.000Z' },
        { fileId: 'file-2', filename: 'recent2.pdf', lastAccessedAt: '2024-01-02T00:00:00.000Z' },
      ];

      mockFileService.getRecentFiles.mockResolvedValue(mockFiles);

      const res = await request(app).get('/api/recent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: mockFiles });
      expect(mockFileService.getRecentFiles).toHaveBeenCalledWith('user-123');
    });

    it('should return 200 with empty array when no recent files', async () => {
      mockFileService.getRecentFiles.mockResolvedValue([]);

      const res = await request(app).get('/api/recent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.getRecentFiles.mockRejectedValue(
        new AppError({ code: ErrorCode.INTERNAL_ERROR, message: 'Internal error' }),
      );

      const res = await request(app).get('/api/recent');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/shared', () => {
    it('should return 200 with shared files', async () => {
      const mockResult = {
        items: [
          { fileId: 'file-1', sharedBy: 'owner-1', permissions: 'view', sharedAt: '2024-01-01T00:00:00.000Z' },
        ],
        nextCursor: undefined,
        hasMore: false,
      };

      mockShareService.getSharedWithMe.mockResolvedValue(mockResult);

      const res = await request(app).get('/api/shared');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockShareService.getSharedWithMe).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { limit: undefined, cursor: undefined },
      });
    });

    it('should pass pagination params to service', async () => {
      mockShareService.getSharedWithMe.mockResolvedValue({ items: [], hasMore: false });

      await request(app).get('/api/shared?limit=10&cursor=abc');

      expect(mockShareService.getSharedWithMe).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { limit: 10, cursor: 'abc' },
      });
    });

    it('should return 200 with empty result when nothing shared', async () => {
      mockShareService.getSharedWithMe.mockResolvedValue({ items: [], hasMore: false });

      const res = await request(app).get('/api/shared');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockShareService.getSharedWithMe.mockRejectedValue(
        new AppError({ code: ErrorCode.INTERNAL_ERROR, message: 'Internal error' }),
      );

      const res = await request(app).get('/api/shared');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
