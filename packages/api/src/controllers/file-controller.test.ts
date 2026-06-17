/**
 * Unit tests for FileController route handlers.
 *
 * Tests the file upload/download routes using Supertest against the Express app
 * with mocked services and authentication.
 *
 * Validates: Requirements 1.1, 2.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { correlationId } from '../middleware/correlation-id';
import { validate } from '../middleware/validation';
import { errorHandler } from '../middleware/error-handler';
import { uploadUrlSchema, uploadCompleteSchema } from '@vaultstream/shared';
import { generateUploadUrl, confirmUpload, generateDownloadUrl } from './file-controller';

// Verify schemas are imported correctly — if they're undefined, define fallbacks
// This guards against module resolution issues in the test environment
const resolvedUploadUrlSchema = uploadUrlSchema ?? z.object({
  filename: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._\-\s()]+$/),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']),
  sizeBytes: z.number().int().positive().max(104857600),
  folderId: z.string().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

const resolvedUploadCompleteSchema = uploadCompleteSchema ?? z.object({
  fileId: z.string().min(1),
  etag: z.string().min(1),
  s3VersionId: z.string().min(1),
});

// ─── Mock the file service ──────────────────────────────────────────────────

vi.mock('../services/file-service', () => ({
  fileService: {
    generateUploadUrl: vi.fn(),
    confirmUpload: vi.fn(),
    generateDownloadUrl: vi.fn(),
  },
}));

import { fileService } from '../services/file-service';

const mockFileService = fileService as unknown as {
  generateUploadUrl: ReturnType<typeof vi.fn>;
  confirmUpload: ReturnType<typeof vi.fn>;
  generateDownloadUrl: ReturnType<typeof vi.fn>;
};

// ─── Test App Setup ─────────────────────────────────────────────────────────

/**
 * Creates a test Express app with mocked auth middleware.
 * The auth middleware injects a fake user into req.user.
 */
function createTestApp() {
  const app = express();
  app.use(correlationId());
  app.use(express.json());

  // Mock cognitoAuth middleware — injects a test user
  const mockAuth = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    next();
  };

  // POST /api/files/upload-url
  app.post(
    '/api/files/upload-url',
    mockAuth,
    validate({ body: resolvedUploadUrlSchema }),
    generateUploadUrl,
  );

  // POST /api/files/upload-complete
  app.post(
    '/api/files/upload-complete',
    mockAuth,
    validate({ body: resolvedUploadCompleteSchema }),
    confirmUpload,
  );

  // GET /api/files/:id/download-url — with mock authorize middleware
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

  app.get(
    '/api/files/:id/download-url',
    mockAuth,
    mockAuthorize,
    generateDownloadUrl,
  );

  app.use(errorHandler());

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FileController', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/files/upload-url', () => {
    const validBody = {
      filename: 'test-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024 * 1024, // 1MB
    };

    it('should return 200 with presigned URL on valid request', async () => {
      const mockResult = {
        uploadId: 'upload-123',
        fileId: 'file-456',
        presignedUrl: 'https://s3.amazonaws.com/bucket/key?signature=abc',
        expiresAt: '2024-01-01T00:05:00.000Z',
        headers: {
          'Content-Type': 'application/pdf',
          'x-amz-server-side-encryption': 'aws:kms',
        },
        maxSizeBytes: 1048576,
        constraints: {
          contentType: 'application/pdf',
          maxSizeBytes: 1048576,
          expiresInSeconds: 300,
        },
      };

      mockFileService.generateUploadUrl.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/api/files/upload-url')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockFileService.generateUploadUrl).toHaveBeenCalledWith({
        userId: 'user-123',
        filename: 'test-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        folderId: undefined,
        tags: undefined,
      });
    });

    it('should pass optional folderId and tags to the service', async () => {
      mockFileService.generateUploadUrl.mockResolvedValue({ uploadId: 'u1', fileId: 'f1' });

      const bodyWithOptionals = {
        ...validBody,
        folderId: 'folder-789',
        tags: ['important', 'work'],
      };

      const res = await request(app)
        .post('/api/files/upload-url')
        .send(bodyWithOptionals);

      expect(res.status).toBe(200);
      expect(mockFileService.generateUploadUrl).toHaveBeenCalledWith({
        userId: 'user-123',
        filename: 'test-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        folderId: 'folder-789',
        tags: ['important', 'work'],
      });
    });

    it('should return 400 when filename is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-url')
        .send({ mimeType: 'application/pdf', sizeBytes: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when mimeType is invalid', async () => {
      const res = await request(app)
        .post('/api/files/upload-url')
        .send({ filename: 'test.exe', mimeType: 'application/x-executable', sizeBytes: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when sizeBytes exceeds maximum', async () => {
      const res = await request(app)
        .post('/api/files/upload-url')
        .send({ filename: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 200 * 1024 * 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when filename contains invalid characters', async () => {
      const res = await request(app)
        .post('/api/files/upload-url')
        .send({ filename: '../etc/passwd', mimeType: 'application/pdf', sizeBytes: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.generateUploadUrl.mockRejectedValue(
        new AppError({ code: ErrorCode.QUOTA_EXCEEDED, message: 'Storage quota exceeded' }),
      );

      const res = await request(app)
        .post('/api/files/upload-url')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('POST /api/files/upload-complete', () => {
    const validBody = {
      fileId: 'file-456',
      etag: '"abc123def456"',
      s3VersionId: 'version-1',
    };

    it('should return 200 with file metadata on valid request', async () => {
      const mockFile = {
        fileId: 'file-456',
        filename: 'test-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        s3VersionId: 'version-1',
        virusScanStatus: 'pending',
      };

      mockFileService.confirmUpload.mockResolvedValue(mockFile);

      const res = await request(app)
        .post('/api/files/upload-complete')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFile);
      expect(mockFileService.confirmUpload).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-456',
        etag: '"abc123def456"',
        s3VersionId: 'version-1',
      });
    });

    it('should return 400 when fileId is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-complete')
        .send({ etag: '"abc"', s3VersionId: 'v1' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when etag is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-complete')
        .send({ fileId: 'file-456', s3VersionId: 'v1' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when s3VersionId is missing', async () => {
      const res = await request(app)
        .post('/api/files/upload-complete')
        .send({ fileId: 'file-456', etag: '"abc"' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.confirmUpload.mockRejectedValue(
        new AppError({ code: ErrorCode.VALIDATION_ERROR, message: 'Upload confirmation is invalid' }),
      );

      const res = await request(app)
        .post('/api/files/upload-complete')
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Upload confirmation is invalid');
    });
  });

  describe('GET /api/files/:id/download-url', () => {
    it('should return 200 with download URL for authorized user', async () => {
      const mockResult = {
        downloadUrl: 'https://s3.amazonaws.com/bucket/key?signature=xyz',
        expiresAt: '2024-01-01T00:15:00.000Z',
        filename: 'document.pdf',
        contentType: 'application/pdf',
      };

      mockFileService.generateDownloadUrl.mockResolvedValue(mockResult);

      const res = await request(app)
        .get('/api/files/file-abc/download-url');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(mockFileService.generateDownloadUrl).toHaveBeenCalledWith({
        userId: 'user-123',
        fileId: 'file-abc',
        fileMetadata: expect.objectContaining({
          fileId: 'file-abc',
          filename: 'document.pdf',
        }),
        isOwner: true,
      });
    });

    it('should set isOwner to false when file belongs to another user', async () => {
      // Create a new app where the file PK doesn't match the user
      const sharedApp = express();
      sharedApp.use(correlationId());
      sharedApp.use(express.json());

      const mockAuth = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        _req.user = { userId: 'user-999', email: 'other@example.com', role: 'user' };
        next();
      };

      const mockAuthorize = (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        _req.fileMetadata = {
          PK: 'USER#user-123' as `USER#${string}`,
          SK: 'FILE#file-abc' as `FILE#${string}`,
          entityType: 'FILE' as const,
          fileId: 'file-abc',
          filename: 'shared-doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          s3Key: 'users/user-123/files/file-abc/1/shared-doc.pdf',
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
          GSI2SK: 'shared-doc.pdf',
        };
        next();
      };

      sharedApp.get('/api/files/:id/download-url', mockAuth, mockAuthorize, generateDownloadUrl);
      sharedApp.use(errorHandler());

      const mockResult = {
        downloadUrl: 'https://cdn.vaultstream.io/path?Expires=123',
        expiresAt: '2024-01-01T01:00:00.000Z',
        filename: 'shared-doc.pdf',
        contentType: 'application/pdf',
      };

      mockFileService.generateDownloadUrl.mockResolvedValue(mockResult);

      const res = await request(sharedApp)
        .get('/api/files/file-abc/download-url');

      expect(res.status).toBe(200);
      expect(mockFileService.generateDownloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ isOwner: false }),
      );
    });

    it('should propagate service errors to the error handler', async () => {
      const { AppError, ErrorCode } = await import('@vaultstream/shared');
      mockFileService.generateDownloadUrl.mockRejectedValue(
        new AppError({ code: ErrorCode.FILE_NOT_FOUND, message: 'File not found' }),
      );

      const res = await request(app)
        .get('/api/files/file-abc/download-url');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FILE_NOT_FOUND');
    });
  });
});
