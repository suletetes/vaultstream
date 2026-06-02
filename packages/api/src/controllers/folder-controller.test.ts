/**
 * Unit tests for FolderController route handlers.
 *
 * Tests folder CRUD operations and file move using Supertest against
 * the Express app with mocked services and authentication.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { correlationId } from '../middleware/correlation-id';
import { validate } from '../middleware/validation';
import { errorHandler } from '../middleware/error-handler';
import { createFolderSchema, renameFolderSchema, moveFileSchema } from '@vaultstream/shared';
import { createFolder, listContents, renameFolder, deleteFolder, moveFile } from './folder-controller';

// ─── Mock the folder service ────────────────────────────────────────────────

vi.mock('../services/folder-service', () => ({
  folderService: {
    createFolder: vi.fn(),
    listContents: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveFile: vi.fn(),
  },
}));

import { folderService } from '../services/folder-service';

const mockFolderService = folderService as unknown as {
  createFolder: ReturnType<typeof vi.fn>;
  listContents: ReturnType<typeof vi.fn>;
  renameFolder: ReturnType<typeof vi.fn>;
  deleteFolder: ReturnType<typeof vi.fn>;
  moveFile: ReturnType<typeof vi.fn>;
};

// ─── Test App Setup ─────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(correlationId());
  app.use(express.json());

  const mockAuth = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    next();
  };

  // POST /api/folders
  app.post(
    '/api/folders',
    mockAuth,
    validate({ body: createFolderSchema }),
    createFolder,
  );

  // GET /api/folders/:id
  app.get('/api/folders/:id', mockAuth, listContents);

  // PUT /api/folders/:id
  app.put(
    '/api/folders/:id',
    mockAuth,
    validate({ body: renameFolderSchema }),
    renameFolder,
  );

  // DELETE /api/folders/:id
  app.delete('/api/folders/:id', mockAuth, deleteFolder);

  // POST /api/files/:id/move
  app.post(
    '/api/files/:id/move',
    mockAuth,
    validate({ body: moveFileSchema }),
    moveFile,
  );

  app.use(errorHandler());

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FolderController', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/folders', () => {
    it('should return 201 with created folder on valid request', async () => {
      const mockFolder = {
        folderId: 'folder-abc',
        folderName: 'Documents',
        parentFolderId: 'ROOT',
        fileCount: 0,
        totalSizeBytes: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFolderService.createFolder.mockResolvedValue(mockFolder);

      const res = await request(app)
        .post('/api/folders')
        .send({ folderName: 'Documents' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockFolder);
      expect(mockFolderService.createFolder).toHaveBeenCalledWith({
        userId: 'user-123',
        folderName: 'Documents',
        parentFolderId: 'ROOT',
      });
    });

    it('should pass parentFolderId when provided', async () => {
      mockFolderService.createFolder.mockResolvedValue({ folderId: 'folder-xyz' });

      const res = await request(app)
        .post('/api/folders')
        .send({ folderName: 'Subfolder', parentFolderId: 'folder-parent' });

      expect(res.status).toBe(201);
      expect(mockFolderService.createFolder).toHaveBeenCalledWith({
        userId: 'user-123',
        folderName: 'Subfolder',
        parentFolderId: 'folder-parent',
      });
    });

    it('should return 400 when folderName is missing', async () => {
      const res = await request(app)
        .post('/api/folders')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when folderName contains invalid characters', async () => {
      const res = await request(app)
        .post('/api/folders')
        .send({ folderName: 'invalid/name' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFolderService.createFolder.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Maximum nesting depth has been exceeded' }),
      );

      const res = await request(app)
        .post('/api/folders')
        .send({ folderName: 'Deep Folder' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Maximum nesting depth has been exceeded');
    });
  });

  describe('GET /api/folders/:id', () => {
    it('should return 200 with folder contents', async () => {
      const mockResult = {
        items: [
          { entityType: 'FOLDER', folderId: 'sub-1', folderName: 'Subfolder' },
          { entityType: 'FILE', fileId: 'file-1', filename: 'doc.pdf' },
        ],
        nextCursor: null,
        hasMore: false,
      };

      mockFolderService.listContents.mockResolvedValue(mockResult);

      const res = await request(app).get('/api/folders/folder-abc');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockFolderService.listContents).toHaveBeenCalledWith({
        userId: 'user-123',
        folderId: 'folder-abc',
        pagination: { cursor: undefined, limit: undefined },
      });
    });

    it('should pass pagination params from query string', async () => {
      mockFolderService.listContents.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      const res = await request(app).get('/api/folders/folder-abc?cursor=abc123&limit=10');

      expect(res.status).toBe(200);
      expect(mockFolderService.listContents).toHaveBeenCalledWith({
        userId: 'user-123',
        folderId: 'folder-abc',
        pagination: { cursor: 'abc123', limit: 10 },
      });
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFolderService.listContents.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Folder not found' }),
      );

      const res = await request(app).get('/api/folders/nonexistent');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Folder not found');
    });
  });

  describe('PUT /api/folders/:id', () => {
    it('should return 200 with updated folder on valid request', async () => {
      const mockFolder = {
        folderId: 'folder-abc',
        folderName: 'Renamed Folder',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };

      mockFolderService.renameFolder.mockResolvedValue(mockFolder);

      const res = await request(app)
        .put('/api/folders/folder-abc')
        .send({ folderName: 'Renamed Folder' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFolder);
      expect(mockFolderService.renameFolder).toHaveBeenCalledWith({
        userId: 'user-123',
        folderId: 'folder-abc',
        newName: 'Renamed Folder',
      });
    });

    it('should return 400 when folderName is missing', async () => {
      const res = await request(app)
        .put('/api/folders/folder-abc')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when folderName contains invalid characters', async () => {
      const res = await request(app)
        .put('/api/folders/folder-abc')
        .send({ folderName: 'bad*name' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/folders/:id', () => {
    it('should return 204 on successful deletion', async () => {
      mockFolderService.deleteFolder.mockResolvedValue(undefined);

      const res = await request(app).delete('/api/folders/folder-abc');

      expect(res.status).toBe(204);
      expect(mockFolderService.deleteFolder).toHaveBeenCalledWith({
        userId: 'user-123',
        folderId: 'folder-abc',
      });
    });

    it('should propagate service errors when folder is not empty', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFolderService.deleteFolder.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Folder must be empty before deletion' }),
      );

      const res = await request(app).delete('/api/folders/folder-abc');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Folder must be empty before deletion');
    });
  });

  describe('POST /api/files/:id/move', () => {
    it('should return 200 on successful file move', async () => {
      mockFolderService.moveFile.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/files/file-abc/move')
        .send({ targetFolderId: 'folder-target' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('File moved successfully');
      expect(mockFolderService.moveFile).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
        targetFolderId: 'folder-target',
      });
    });

    it('should return 400 when targetFolderId is missing', async () => {
      const res = await request(app)
        .post('/api/files/file-abc/move')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFolderService.moveFile.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Target folder is invalid' }),
      );

      const res = await request(app)
        .post('/api/files/file-abc/move')
        .send({ targetFolderId: 'nonexistent' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Target folder is invalid');
    });
  });
});
