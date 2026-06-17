/**
 * Unit tests for Authorization Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ErrorCode, FileEntity, ShareEntity } from '@vaultstream/shared';

// Mock the db module before importing the middleware
vi.mock('../db', () => ({
  getItem: vi.fn(),
  userPK: (userId: string) => `USER#${userId}`,
  fileSK: (fileId: string) => `FILE#${fileId}`,
  sharePK: (fileId: string) => `FILE#${fileId}`,
  shareSK: (userId: string) => `SHARE#${userId}`,
}));

import { getItem } from '../db';
import { authorizeFileAccess, hasPermission } from './authorize';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const mockGetItem = getItem as ReturnType<typeof vi.fn>;

function createMockRequest(userId?: string, fileId?: string): Partial<Request> {
  return {
    user: userId ? { userId, email: 'test@example.com', role: 'user' } : undefined,
    params: { id: fileId } as Record<string, string>,
  };
}

function createMockResponse(): Partial<Response> {
  return {};
}

function createMockNext(): NextFunction & { mock: { calls: unknown[][] } } {
  return vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
}

function createFileEntity(userId: string, fileId: string): FileEntity {
  return {
    PK: `USER#${userId}`,
    SK: `FILE#${fileId}`,
    entityType: 'FILE',
    fileId,
    filename: 'test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    s3Key: `users/${userId}/${fileId}`,
    s3VersionId: 'v1',
    encryptedDataKey: 'encrypted-key',
    kmsKeyId: 'kms-key-id',
    thumbnailKey: null,
    folderId: 'ROOT',
    tags: [],
    storageClass: 'STANDARD',
    virusScanStatus: 'clean',
    version: 1,
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastAccessedAt: '2024-01-01T00:00:00Z',
    GSI1PK: `USER#${userId}`,
    GSI1SK: '2024-01-01T00:00:00Z',
    GSI2PK: 'FOLDER#ROOT',
    GSI2SK: 'test.pdf',
  };
}

function createShareEntity(
  fileId: string,
  sharedBy: string,
  sharedWith: string,
  permissions: 'view' | 'download' | 'edit',
  expiresAt?: number,
): ShareEntity {
  return {
    PK: `FILE#${fileId}`,
    SK: `SHARE#${sharedWith}`,
    entityType: 'SHARE',
    fileId,
    sharedBy,
    sharedWith,
    permissions,
    sharedAt: '2024-01-01T00:00:00Z',
    ...(expiresAt !== undefined && { expiresAt }),
    GSI3PK: `USER#${sharedWith}`,
    GSI3SK: '2024-01-01T00:00:00Z',
  };
}

// ─── hasPermission Tests ────────────────────────────────────────────────────

describe('hasPermission', () => {
  it('should return true when user has exact required permission', () => {
    expect(hasPermission('view', 'view')).toBe(true);
    expect(hasPermission('download', 'download')).toBe(true);
    expect(hasPermission('edit', 'edit')).toBe(true);
  });

  it('should return true when user has higher permission than required', () => {
    expect(hasPermission('download', 'view')).toBe(true);
    expect(hasPermission('edit', 'view')).toBe(true);
    expect(hasPermission('edit', 'download')).toBe(true);
  });

  it('should return false when user has lower permission than required', () => {
    expect(hasPermission('view', 'download')).toBe(false);
    expect(hasPermission('view', 'edit')).toBe(false);
    expect(hasPermission('download', 'edit')).toBe(false);
  });
});

// ─── authorizeFileAccess Tests ──────────────────────────────────────────────

describe('authorizeFileAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return UNAUTHORIZED when user is not authenticated', async () => {
    const req = createMockRequest(undefined, 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('should return FORBIDDEN when fileId is missing', async () => {
    const req = {
      user: { userId: 'user-1', email: 'test@example.com', role: 'user' as const },
      params: {} as Record<string, string>,
    } as unknown as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should allow access and attach file when user is the owner', async () => {
    const file = createFileEntity('user-1', 'file-123');
    mockGetItem.mockResolvedValueOnce(file);

    const req = createMockRequest('user-1', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(); // called with no args = success
    expect(req.fileMetadata).toEqual(file);
    expect(req.share).toBeUndefined();
  });

  it('should allow owner access regardless of required permission level', async () => {
    const file = createFileEntity('user-1', 'file-123');
    mockGetItem.mockResolvedValueOnce(file);

    const req = createMockRequest('user-1', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('edit');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.fileMetadata).toEqual(file);
  });

  it('should return FORBIDDEN when no ownership or share exists', async () => {
    mockGetItem.mockResolvedValueOnce(null); // no ownership
    mockGetItem.mockResolvedValueOnce(null); // no share

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    expect(error.message).toBe('Access denied');
  });

  it('should allow access via share with sufficient permission', async () => {
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'download');
    const ownerFile = createFileEntity('owner-1', 'file-123');

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share exists
    mockGetItem.mockResolvedValueOnce(ownerFile); // fetch owner's file

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.fileMetadata).toEqual(ownerFile);
    expect(req.share).toEqual(share);
  });

  it('should return FORBIDDEN when share permission is insufficient', async () => {
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'view');

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share exists but view only

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('download');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should return FORBIDDEN when share has expired', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'edit', pastTimestamp);

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share exists but expired

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should allow access when share has no expiration', async () => {
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'edit');
    const ownerFile = createFileEntity('owner-1', 'file-123');

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share without expiresAt
    mockGetItem.mockResolvedValueOnce(ownerFile); // fetch owner's file

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('edit');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.fileMetadata).toEqual(ownerFile);
    expect(req.share).toEqual(share);
  });

  it('should allow access when share expiration is in the future', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'download', futureTimestamp);
    const ownerFile = createFileEntity('owner-1', 'file-123');

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share with future expiration
    mockGetItem.mockResolvedValueOnce(ownerFile); // fetch owner's file

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('download');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.fileMetadata).toEqual(ownerFile);
    expect(req.share).toEqual(share);
  });

  it('should return FORBIDDEN when owner file cannot be found via share', async () => {
    const share = createShareEntity('file-123', 'owner-1', 'user-2', 'edit');

    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(share); // share exists
    mockGetItem.mockResolvedValueOnce(null); // owner's file not found

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should handle unexpected errors gracefully', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('DynamoDB connection failed'));

    const req = createMockRequest('user-1', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('should not reveal file existence when access is denied', async () => {
    mockGetItem.mockResolvedValueOnce(null); // not owner
    mockGetItem.mockResolvedValueOnce(null); // no share

    const req = createMockRequest('user-2', 'file-123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = authorizeFileAccess('view');
    await middleware(req, res, next);

    const error = next.mock.calls[0][0] as any;
    // Message should be generic "Access denied" — not "File not found"
    expect(error.message).toBe('Access denied');
    expect(error.statusCode).toBe(403);
  });
});
