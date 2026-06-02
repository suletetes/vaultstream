import { describe, it, expect } from 'vitest';
import {
  uploadUrlSchema,
  createFolderSchema,
  createShareSchema,
  searchSchema,
  uploadCompleteSchema,
  createCommentSchema,
  bulkDownloadSchema,
  paginationSchema,
} from './index';

describe('uploadUrlSchema', () => {
  it('accepts a valid upload request', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional folderId and tags', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 5000,
      folderId: 'folder-123',
      tags: ['vacation', 'summer'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty filename', () => {
    const result = uploadUrlSchema.safeParse({
      filename: '',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects filename with path traversal characters', () => {
    const result = uploadUrlSchema.safeParse({
      filename: '../etc/passwd',
      mimeType: 'text/plain',
      sizeBytes: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects filename exceeding 255 characters', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'a'.repeat(256),
      mimeType: 'text/plain',
      sizeBytes: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unsupported MIME type', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'video.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects file size exceeding 100MB', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'large.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 104_857_601,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero file size', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'empty.txt',
      mimeType: 'text/plain',
      sizeBytes: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative file size', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'file.txt',
      mimeType: 'text/plain',
      sizeBytes: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 tags', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'file.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('accepts filename with spaces and parentheses', () => {
    const result = uploadUrlSchema.safeParse({
      filename: 'My Document (1).pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
  });
});

describe('createFolderSchema', () => {
  it('accepts a valid folder name', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'My Documents',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentFolderId).toBe('ROOT');
    }
  });

  it('accepts folder with explicit parentFolderId', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'Subfolder',
      parentFolderId: 'parent-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentFolderId).toBe('parent-123');
    }
  });

  it('rejects folder name with forward slash', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'path/to/folder',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with backslash', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'path\\folder',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with colon', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'C:folder',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with asterisk', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'folder*name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with question mark', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'folder?name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with angle brackets', () => {
    const result1 = createFolderSchema.safeParse({ folderName: 'folder<name' });
    const result2 = createFolderSchema.safeParse({ folderName: 'folder>name' });
    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
  });

  it('rejects folder name with pipe', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'folder|name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name with double quotes', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'folder"name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty folder name', () => {
    const result = createFolderSchema.safeParse({
      folderName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects folder name exceeding 255 characters', () => {
    const result = createFolderSchema.safeParse({
      folderName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('createShareSchema', () => {
  it('accepts a valid share request', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'user@example.com',
      permissions: 'download',
    });
    expect(result.success).toBe(true);
  });

  it('accepts share with expiration and message', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'user@example.com',
      permissions: 'edit',
      expiresInHours: 24,
      message: 'Please review this document',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'not-an-email',
      permissions: 'view',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid permission level', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'user@example.com',
      permissions: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects expiration exceeding 1 year', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'user@example.com',
      permissions: 'view',
      expiresInHours: 8761,
    });
    expect(result.success).toBe(false);
  });

  it('rejects message exceeding 500 characters', () => {
    const result = createShareSchema.safeParse({
      targetUserEmail: 'user@example.com',
      permissions: 'view',
      message: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('searchSchema', () => {
  it('accepts a minimal search request', () => {
    const result = searchSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeShared).toBe(false);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts a full search request', () => {
    const result = searchSchema.safeParse({
      query: 'report',
      tags: ['finance', 'q4'],
      mimeType: 'application/pdf',
      includeShared: true,
      cursor: 'abc123',
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects query exceeding 200 characters', () => {
    const result = searchSchema.safeParse({
      query: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit exceeding 100', () => {
    const result = searchSchema.safeParse({
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit of 0', () => {
    const result = searchSchema.safeParse({
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 tags', () => {
    const result = searchSchema.safeParse({
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('uploadCompleteSchema', () => {
  it('accepts valid upload complete request', () => {
    const result = uploadCompleteSchema.safeParse({
      fileId: 'file-123',
      etag: '"abc123"',
      s3VersionId: 'version-456',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fileId', () => {
    const result = uploadCompleteSchema.safeParse({
      etag: '"abc123"',
      s3VersionId: 'version-456',
    });
    expect(result.success).toBe(false);
  });
});

describe('createCommentSchema', () => {
  it('accepts valid comment', () => {
    const result = createCommentSchema.safeParse({
      content: 'This looks good!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts comment with parentCommentId', () => {
    const result = createCommentSchema.safeParse({
      content: 'I agree',
      parentCommentId: 'comment-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = createCommentSchema.safeParse({
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 2000 characters', () => {
    const result = createCommentSchema.safeParse({
      content: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('bulkDownloadSchema', () => {
  it('accepts valid file IDs', () => {
    const result = bulkDownloadSchema.safeParse({
      fileIds: ['file-1', 'file-2', 'file-3'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty array', () => {
    const result = bulkDownloadSchema.safeParse({
      fileIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 100 files', () => {
    const result = bulkDownloadSchema.safeParse({
      fileIds: Array.from({ length: 101 }, (_, i) => `file-${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('applies defaults when no params provided', () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it('accepts custom limit and cursor', () => {
    const result = paginationSchema.safeParse({
      cursor: 'next-page-token',
      limit: 50,
    });
    expect(result.success).toBe(true);
  });
});
