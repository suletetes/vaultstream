/**
 * Unit tests for FileController versioning, soft-delete, and trash routes.
 *
 * Tests the new file routes using Supertest against the Express app
 * with mocked services and authentication.
 *
 * Validates: Requirements 5.3, 5.4, 6.8, 27.1, 27.2, 27.3, 27.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { correlationId } from '../middleware/correlation-id';
import { errorHandler } from '../middleware/error-handler';
import {
  listVersions,
  restoreVersion,
  softDeleteFile,
  restoreFile,
  getTrashBin,
  emptyTrash,
} from './file-controller';

// ─── Mock the file service ──────────────────────────────────────────────────

vi.mock('../services/file-service', () => ({
  fileService: {
    listVersions: vi.fn(),
    restoreVersion: vi.fn(),
    softDelete: vi.fn(),
    restore: vi.fn(),
    getTrashBin: vi.fn(),
    emptyTrash: vi.fn(),
  },
}));

import { fileService } from '../services/file-service';

const mockFileService = fileService as unknown as {
  listVersions: ReturnType<typeof vi.fn>;
  restoreVersion: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  getTrashBin: ReturnType<typeof vi.fn>;
  emptyTrash: ReturnType<typeof vi.fn>;
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

  // Mock authorizeFileAccess middleware
  const mockAuthorize = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.fileMetadata = {
      PK: 'USER#user-123' as `USER#${string}`,
      SK: 'FILE#file-abc' as `FILE#${string}`,
      entityType: 'FILE' as const,
      fileId: 'file-abc',
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      s3Key: 'users/user-123/files/file-abc/1/document.pdf',
      s3VersionId: 'v1',
      encryptedDataKey: 'encrypted-key',
      kmsKeyId: 'arn:aws:kms:us-east-1:123:key/abc',
      thumbnailKey: null,
      folderId: 'ROOT',
      tags: [],
      storageClass: 'STANDARD' as const,
      virusScanStatus: 'clean' as const,
      version: 1,
      isDeleted: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastAccessedAt: '2024-01-01T00:00:00.000Z',
      GSI1PK: 'USER#user-123' as `USER#${string}`,
      GSI1SK: '2024-01-01T00:00:00.000Z',
      GSI2PK: 'FOLDER#ROOT' as `FOLDER#${string}`,
      GSI2SK: 'document.pdf',
    };
    next();
  };

  // Wire routes
  app.get('/api/files/:id/versions', mockAuth, listVersions);
  app.post('/api/files/:id/versions/:v/restore', mockAuth, restoreVersion);
  app.delete('/api/files/:id', mockAuth, mockAuthorize, softDeleteFile);
  app.post('/api/files/:id/restore', mockAuth, restoreFile);
  app.get('/api/trash', mockAuth, getTrashBin);
  app.delete('/api/trash', mockAuth, emptyTrash);

  app.use(errorHandler());

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FileController — Versioning and Trash', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/files/:id/versions', () => {
    it('should return 200 with paginated versions', async () => {
      const mockResult = {
        items: [
          { versionNumber: 3, fileId: 'file-abc', createdAt: '2024-01-03T00:00:00.000Z' },
          { versionNumber: 2, fileId: 'file-abc', createdAt: '2024-01-02T00:00:00.000Z' },
        ],
        nextCursor: null,
        hasMore: false,
      };

      mockFileService.listVersions.mockResolvedValue(mockResult);

      const res = await request(app).get('/api/files/file-abc/versions');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockFileService.listVersions).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
        pagination: { limit: undefined, cursor: undefined },
      });
    });

    it('should pass pagination params to service', async () => {
      mockFileService.listVersions.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      await request(app).get('/api/files/file-abc/versions?limit=10&cursor=abc123');

      expect(mockFileService.listVersions).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
        pagination: { limit: 10, cursor: 'abc123' },
      });
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.listVersions.mockRejectedValue(
        new AppError({ code: ErrorCode.FORBIDDEN, message: 'Access denied' }),
      );

      const res = await request(app).get('/api/files/file-abc/versions');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/files/:id/versions/:v/restore', () => {
    it('should return 200 with restored file metadata', async () => {
      const mockFile = {
        fileId: 'file-abc',
        filename: 'document.pdf',
        version: 4,
        updatedAt: '2024-01-04T00:00:00.000Z',
      };

      mockFileService.restoreVersion.mockResolvedValue(mockFile);

      const res = await request(app).post('/api/files/file-abc/versions/2/restore');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFile);
      expect(mockFileService.restoreVersion).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
        versionNumber: 2,
      });
    });

    it('should return 400 for invalid version number', async () => {
      const res = await request(app).post('/api/files/file-abc/versions/abc/restore');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for version number 0', async () => {
      const res = await request(app).post('/api/files/file-abc/versions/0/restore');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.restoreVersion.mockRejectedValue(
        new AppError({ code: ErrorCode.VERSION_NOT_FOUND, message: 'Version not found' }),
      );

      const res = await request(app).post('/api/files/file-abc/versions/99/restore');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('VERSION_NOT_FOUND');
    });
  });

  describe('DELETE /api/files/:id', () => {
    it('should return 204 on successful soft-delete', async () => {
      mockFileService.softDelete.mockResolvedValue(undefined);

      const res = await request(app).delete('/api/files/file-abc');

      expect(res.status).toBe(204);
      expect(mockFileService.softDelete).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
      });
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.softDelete.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'File is already deleted' }),
      );

      const res = await request(app).delete('/api/files/file-abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/files/:id/restore', () => {
    it('should return 200 with restored file metadata', async () => {
      const mockFile = {
        fileId: 'file-abc',
        filename: 'document.pdf',
        isDeleted: false,
        updatedAt: '2024-01-04T00:00:00.000Z',
      };

      mockFileService.restore.mockResolvedValue(mockFile);

      const res = await request(app).post('/api/files/file-abc/restore');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFile);
      expect(mockFileService.restore).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
      });
    });

    it('should propagate quota exceeded error', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.restore.mockRejectedValue(
        new AppError({ code: ErrorCode.QUOTA_EXCEEDED, message: 'Storage quota exceeded' }),
      );

      const res = await request(app).post('/api/files/file-abc/restore');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('GET /api/trash', () => {
    it('should return 200 with trash bin items', async () => {
      const mockResult = {
        items: [
          { fileId: 'file-1', filename: 'deleted.pdf', deletedAt: '2024-01-01T00:00:00.000Z', daysRemaining: 25 },
        ],
        nextCursor: null,
        hasMore: false,
      };

      mockFileService.getTrashBin.mockResolvedValue(mockResult);

      const res = await request(app).get('/api/trash');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockFileService.getTrashBin).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { limit: undefined, cursor: undefined },
      });
    });

    it('should pass pagination params', async () => {
      mockFileService.getTrashBin.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      await request(app).get('/api/trash?limit=5&cursor=xyz');

      expect(mockFileService.getTrashBin).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { limit: 5, cursor: 'xyz' },
      });
    });
  });

  describe('DELETE /api/trash', () => {
    it('should return 204 on successful trash empty', async () => {
      mockFileService.emptyTrash.mockResolvedValue({ deletedCount: 3 });

      const res = await request(app).delete('/api/trash');

      expect(res.status).toBe(204);
      expect(mockFileService.emptyTrash).toHaveBeenCalledWith('user-123');
    });

    it('should propagate service errors', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.emptyTrash.mockRejectedValue(
        new AppError({ code: ErrorCode.INTERNAL_ERROR, message: 'Internal error' }),
      );

      const res = await request(app).delete('/api/trash');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
