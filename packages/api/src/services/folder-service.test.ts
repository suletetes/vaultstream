import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderService } from './folder-service';
import { AppError, ErrorCode, MAX_FOLDER_DEPTH } from '@vaultstream/shared';

// Mock the base repository
const mockGetItem = vi.fn();
const mockPutItem = vi.fn();
const mockQueryItems = vi.fn();
const mockUpdateItem = vi.fn();
const mockDeleteItem = vi.fn();

vi.mock('../db/base-repository', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  putItem: (...args: unknown[]) => mockPutItem(...args),
  queryItems: (...args: unknown[]) => mockQueryItems(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
}));

// Mock cache service
const mockCacheService = {
  getFolderContents: vi.fn(),
  setFolderContents: vi.fn(),
  invalidateFolderCache: vi.fn(),
  invalidateUserCache: vi.fn(),
  invalidateFileCache: vi.fn(),
  getRecentFiles: vi.fn(),
  setRecentFiles: vi.fn(),
  getSharedWithMe: vi.fn(),
  setSharedWithMe: vi.fn(),
  getFileMetadata: vi.fn(),
  setFileMetadata: vi.fn(),
  isAvailable: vi.fn().mockReturnValue(true),
};

describe('FolderService', () => {
  let service: FolderService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPutItem.mockResolvedValue(undefined);
    mockUpdateItem.mockResolvedValue(undefined);
    mockDeleteItem.mockResolvedValue(undefined);
    service = new FolderService({ cacheService: mockCacheService });
  });

  describe('createFolder', () => {
    it('should create a top-level folder with ROOT as parent', async () => {
      const result = await service.createFolder({
        userId: 'user-123',
        folderName: 'Documents',
      });

      expect(result.entityType).toBe('FOLDER');
      expect(result.folderName).toBe('Documents');
      expect(result.parentFolderId).toBe('ROOT');
      expect(result.fileCount).toBe(0);
      expect(result.totalSizeBytes).toBe(0);
      expect(result.PK).toBe('USER#user-123');
      expect(result.SK).toMatch(/^FOLDER#/);
      expect(result.GSI2PK).toBe('FOLDER#ROOT');
      expect(result.GSI2SK).toBe('Documents');
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });

    it('should create a subfolder with specified parentFolderId', async () => {
      // Mock parent folder exists at depth 1
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#parent-id',
        entityType: 'FOLDER',
        folderId: 'parent-id',
        parentFolderId: 'ROOT',
      });

      const result = await service.createFolder({
        userId: 'user-123',
        folderName: 'Subfolder',
        parentFolderId: 'parent-id',
      });

      expect(result.parentFolderId).toBe('parent-id');
      expect(result.GSI2PK).toBe('FOLDER#parent-id');
      expect(result.GSI2SK).toBe('Subfolder');
    });

    it('should reject folder names with invalid characters', async () => {
      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test/folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test\\folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test:folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test*folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test?folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test"folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test<folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test>folder' }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createFolder({ userId: 'user-123', folderName: 'test|folder' }),
      ).rejects.toThrow(AppError);
    });

    it('should reject empty folder names', async () => {
      await expect(
        service.createFolder({ userId: 'user-123', folderName: '' }),
      ).rejects.toThrow(AppError);
    });

    it('should reject folder names exceeding 255 characters', async () => {
      const longName = 'a'.repeat(256);
      await expect(
        service.createFolder({ userId: 'user-123', folderName: longName }),
      ).rejects.toThrow(AppError);
    });

    it('should accept folder names with spaces, dots, hyphens, and underscores', async () => {
      const result = await service.createFolder({
        userId: 'user-123',
        folderName: 'My Folder - 2024_v2.0',
      });

      expect(result.folderName).toBe('My Folder - 2024_v2.0');
    });

    it('should reject creation when nesting depth exceeds MAX_FOLDER_DEPTH', async () => {
      // Build a chain of folders at max depth
      // Each call to getFolderDepth will query parent chain
      for (let i = MAX_FOLDER_DEPTH; i >= 1; i--) {
        mockGetItem.mockResolvedValueOnce({
          PK: 'USER#user-123',
          SK: `FOLDER#folder-${i}`,
          entityType: 'FOLDER',
          folderId: `folder-${i}`,
          parentFolderId: i === 1 ? 'ROOT' : `folder-${i - 1}`,
        });
      }

      await expect(
        service.createFolder({
          userId: 'user-123',
          folderName: 'Too Deep',
          parentFolderId: `folder-${MAX_FOLDER_DEPTH}`,
        }),
      ).rejects.toThrow('Maximum nesting depth has been exceeded');
    });

    it('should invalidate parent folder cache after creation', async () => {
      await service.createFolder({
        userId: 'user-123',
        folderName: 'New Folder',
      });

      expect(mockCacheService.invalidateFolderCache).toHaveBeenCalledWith('user-123', 'ROOT');
    });
  });

  describe('listContents', () => {
    it('should return cached results when available', async () => {
      const cachedItems = [
        { entityType: 'FOLDER', folderId: 'f1', folderName: 'Alpha' },
        { entityType: 'FILE', fileId: 'file1', filename: 'beta.pdf' },
      ];
      mockCacheService.getFolderContents.mockResolvedValueOnce({
        _items: JSON.stringify(cachedItems),
      });

      const result = await service.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
      });

      expect(result.items).toHaveLength(2);
      expect(mockQueryItems).not.toHaveBeenCalled();
    });

    it('should query GSI2 on cache miss', async () => {
      mockCacheService.getFolderContents.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'USER#user-123',
            SK: 'FOLDER#f1',
            entityType: 'FOLDER',
            folderId: 'f1',
            folderName: 'Alpha',
            GSI2PK: 'FOLDER#ROOT',
            GSI2SK: 'Alpha',
          },
          {
            PK: 'USER#user-123',
            SK: 'FILE#file1',
            entityType: 'FILE',
            fileId: 'file1',
            filename: 'beta.pdf',
            GSI2PK: 'FOLDER#ROOT',
            GSI2SK: 'beta.pdf',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
      });

      expect(result.items).toHaveLength(2);
      expect(mockQueryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          indexName: 'GSI2',
          keyConditionExpression: 'GSI2PK = :gsi2pk',
          expressionAttributeValues: { ':gsi2pk': 'FOLDER#ROOT' },
          scanIndexForward: true,
        }),
      );
    });

    it('should filter out items not owned by the user', async () => {
      mockCacheService.getFolderContents.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'USER#user-123',
            SK: 'FOLDER#f1',
            entityType: 'FOLDER',
            folderId: 'f1',
            folderName: 'Mine',
          },
          {
            PK: 'USER#other-user',
            SK: 'FOLDER#f2',
            entityType: 'FOLDER',
            folderId: 'f2',
            folderName: 'Not Mine',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await service.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
      });

      expect(result.items).toHaveLength(1);
      expect((result.items[0] as FolderEntity).folderName).toBe('Mine');
    });

    it('should populate cache on miss', async () => {
      mockCacheService.getFolderContents.mockResolvedValueOnce(null);
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'USER#user-123',
            SK: 'FOLDER#f1',
            entityType: 'FOLDER',
            folderId: 'f1',
            folderName: 'Alpha',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      await service.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
      });

      expect(mockCacheService.setFolderContents).toHaveBeenCalledWith(
        'user-123',
        'ROOT',
        expect.objectContaining({ _items: expect.any(String) }),
      );
    });

    it('should support pagination with cursor', async () => {
      mockCacheService.getFolderContents.mockResolvedValueOnce(null);
      const lastKey = { GSI2PK: 'FOLDER#ROOT', GSI2SK: 'middle' };
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'USER#user-123',
            SK: 'FILE#file2',
            entityType: 'FILE',
            fileId: 'file2',
            filename: 'next.pdf',
          },
        ],
        lastEvaluatedKey: lastKey,
      });

      const result = await service.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
        pagination: { limit: 1 },
      });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('renameFolder', () => {
    it('should rename a folder successfully', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        folderName: 'Old Name',
        parentFolderId: 'ROOT',
        fileCount: 5,
        totalSizeBytes: 1000,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        GSI2PK: 'FOLDER#ROOT',
        GSI2SK: 'Old Name',
      });

      const result = await service.renameFolder({
        userId: 'user-123',
        folderId: 'folder-1',
        newName: 'New Name',
      });

      expect(result.folderName).toBe('New Name');
      expect(result.GSI2SK).toBe('New Name');
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'USER#user-123',
        'FOLDER#folder-1',
        expect.objectContaining({
          folderName: 'New Name',
          GSI2SK: 'New Name',
        }),
      );
    });

    it('should reject invalid new names', async () => {
      await expect(
        service.renameFolder({
          userId: 'user-123',
          folderId: 'folder-1',
          newName: 'invalid/name',
        }),
      ).rejects.toThrow(AppError);
    });

    it('should throw when folder does not exist', async () => {
      mockGetItem.mockResolvedValueOnce(null);

      await expect(
        service.renameFolder({
          userId: 'user-123',
          folderId: 'nonexistent',
          newName: 'Valid Name',
        }),
      ).rejects.toThrow('Folder not found');
    });

    it('should invalidate parent folder cache after rename', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        folderName: 'Old Name',
        parentFolderId: 'parent-folder',
        fileCount: 0,
        totalSizeBytes: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        GSI2PK: 'FOLDER#parent-folder',
        GSI2SK: 'Old Name',
      });

      await service.renameFolder({
        userId: 'user-123',
        folderId: 'folder-1',
        newName: 'Renamed',
      });

      expect(mockCacheService.invalidateFolderCache).toHaveBeenCalledWith('user-123', 'parent-folder');
    });
  });

  describe('deleteFolder', () => {
    it('should delete an empty folder', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        folderName: 'Empty Folder',
        parentFolderId: 'ROOT',
        fileCount: 0,
        totalSizeBytes: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        GSI2PK: 'FOLDER#ROOT',
        GSI2SK: 'Empty Folder',
      });
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.deleteFolder({ userId: 'user-123', folderId: 'folder-1' });

      expect(mockDeleteItem).toHaveBeenCalledWith('USER#user-123', 'FOLDER#folder-1');
    });

    it('should reject deletion of non-empty folder', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        folderName: 'Has Files',
        parentFolderId: 'ROOT',
        fileCount: 3,
        totalSizeBytes: 5000,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        GSI2PK: 'FOLDER#ROOT',
        GSI2SK: 'Has Files',
      });
      mockQueryItems.mockResolvedValueOnce({
        items: [{ entityType: 'FILE', fileId: 'file-1' }],
        lastEvaluatedKey: undefined,
      });

      await expect(
        service.deleteFolder({ userId: 'user-123', folderId: 'folder-1' }),
      ).rejects.toThrow('Folder must be empty before deletion');
    });

    it('should throw when folder does not exist', async () => {
      mockGetItem.mockResolvedValueOnce(null);

      await expect(
        service.deleteFolder({ userId: 'user-123', folderId: 'nonexistent' }),
      ).rejects.toThrow('Folder not found');
    });

    it('should invalidate parent folder cache after deletion', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        folderName: 'To Delete',
        parentFolderId: 'parent-id',
        fileCount: 0,
        totalSizeBytes: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        GSI2PK: 'FOLDER#parent-id',
        GSI2SK: 'To Delete',
      });
      mockQueryItems.mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined });

      await service.deleteFolder({ userId: 'user-123', folderId: 'folder-1' });

      expect(mockCacheService.invalidateFolderCache).toHaveBeenCalledWith('user-123', 'parent-id');
    });
  });

  describe('moveFile', () => {
    it('should move a file to a different folder', async () => {
      // Mock target folder exists
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#target-folder',
        entityType: 'FOLDER',
        folderId: 'target-folder',
        folderName: 'Target',
        parentFolderId: 'ROOT',
        fileCount: 2,
        totalSizeBytes: 500,
      });

      // Mock file metadata
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FILE#file-1',
        entityType: 'FILE',
        fileId: 'file-1',
        filename: 'document.pdf',
        folderId: 'source-folder',
        sizeBytes: 1024,
      });

      // Mock source folder for counter update
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#source-folder',
        entityType: 'FOLDER',
        folderId: 'source-folder',
        fileCount: 5,
        totalSizeBytes: 5000,
      });

      // Mock target folder for counter update
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#target-folder',
        entityType: 'FOLDER',
        folderId: 'target-folder',
        fileCount: 2,
        totalSizeBytes: 500,
      });

      await service.moveFile({
        userId: 'user-123',
        fileId: 'file-1',
        targetFolderId: 'target-folder',
      });

      // Verify file was updated
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'USER#user-123',
        'FILE#file-1',
        expect.objectContaining({
          folderId: 'target-folder',
          GSI2PK: 'FOLDER#target-folder',
          GSI2SK: 'document.pdf',
        }),
      );
    });

    it('should move a file to ROOT', async () => {
      // Mock file metadata (no target folder lookup needed for ROOT)
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FILE#file-1',
        entityType: 'FILE',
        fileId: 'file-1',
        filename: 'document.pdf',
        folderId: 'source-folder',
        sizeBytes: 1024,
      });

      // Mock source folder for counter update
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#source-folder',
        entityType: 'FOLDER',
        folderId: 'source-folder',
        fileCount: 5,
        totalSizeBytes: 5000,
      });

      await service.moveFile({
        userId: 'user-123',
        fileId: 'file-1',
        targetFolderId: 'ROOT',
      });

      expect(mockUpdateItem).toHaveBeenCalledWith(
        'USER#user-123',
        'FILE#file-1',
        expect.objectContaining({
          folderId: 'ROOT',
          GSI2PK: 'FOLDER#ROOT',
        }),
      );
    });

    it('should reject move to non-existent target folder', async () => {
      mockGetItem.mockResolvedValueOnce(null); // target folder not found

      await expect(
        service.moveFile({
          userId: 'user-123',
          fileId: 'file-1',
          targetFolderId: 'nonexistent',
        }),
      ).rejects.toThrow('Target folder is invalid');
    });

    it('should reject move when file does not exist', async () => {
      // Mock target folder exists
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#target-folder',
        entityType: 'FOLDER',
        folderId: 'target-folder',
      });

      // Mock file not found
      mockGetItem.mockResolvedValueOnce(null);

      await expect(
        service.moveFile({
          userId: 'user-123',
          fileId: 'nonexistent-file',
          targetFolderId: 'target-folder',
        }),
      ).rejects.toThrow('File not found');
    });

    it('should not move if file is already in target folder', async () => {
      // Mock target folder exists
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#same-folder',
        entityType: 'FOLDER',
        folderId: 'same-folder',
      });

      // Mock file already in target folder
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FILE#file-1',
        entityType: 'FILE',
        fileId: 'file-1',
        filename: 'document.pdf',
        folderId: 'same-folder',
        sizeBytes: 1024,
      });

      await service.moveFile({
        userId: 'user-123',
        fileId: 'file-1',
        targetFolderId: 'same-folder',
      });

      // Should not call updateItem for the file
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('should invalidate both source and target folder caches', async () => {
      // Mock target folder exists
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#target-folder',
        entityType: 'FOLDER',
        folderId: 'target-folder',
        fileCount: 0,
        totalSizeBytes: 0,
      });

      // Mock file metadata
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FILE#file-1',
        entityType: 'FILE',
        fileId: 'file-1',
        filename: 'doc.pdf',
        folderId: 'source-folder',
        sizeBytes: 512,
      });

      // Mock source folder for counter update
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#source-folder',
        entityType: 'FOLDER',
        folderId: 'source-folder',
        fileCount: 3,
        totalSizeBytes: 2000,
      });

      // Mock target folder for counter update
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#target-folder',
        entityType: 'FOLDER',
        folderId: 'target-folder',
        fileCount: 0,
        totalSizeBytes: 0,
      });

      await service.moveFile({
        userId: 'user-123',
        fileId: 'file-1',
        targetFolderId: 'target-folder',
      });

      expect(mockCacheService.invalidateFolderCache).toHaveBeenCalledWith('user-123', 'source-folder');
      expect(mockCacheService.invalidateFolderCache).toHaveBeenCalledWith('user-123', 'target-folder');
    });
  });

  describe('getFolderDepth', () => {
    it('should return 0 for ROOT', async () => {
      const depth = await service.getFolderDepth('user-123', 'ROOT');
      expect(depth).toBe(0);
    });

    it('should return 1 for a top-level folder', async () => {
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        parentFolderId: 'ROOT',
      });

      const depth = await service.getFolderDepth('user-123', 'folder-1');
      expect(depth).toBe(1);
    });

    it('should return correct depth for nested folders', async () => {
      // folder-3 -> folder-2 -> folder-1 -> ROOT
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-3',
        entityType: 'FOLDER',
        folderId: 'folder-3',
        parentFolderId: 'folder-2',
      });
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-2',
        entityType: 'FOLDER',
        folderId: 'folder-2',
        parentFolderId: 'folder-1',
      });
      mockGetItem.mockResolvedValueOnce({
        PK: 'USER#user-123',
        SK: 'FOLDER#folder-1',
        entityType: 'FOLDER',
        folderId: 'folder-1',
        parentFolderId: 'ROOT',
      });

      const depth = await service.getFolderDepth('user-123', 'folder-3');
      expect(depth).toBe(3);
    });
  });

  describe('without cache service', () => {
    it('should work without cache service', async () => {
      const serviceNoCache = new FolderService({ cacheService: null });

      const result = await serviceNoCache.createFolder({
        userId: 'user-123',
        folderName: 'No Cache Folder',
      });

      expect(result.folderName).toBe('No Cache Folder');
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });

    it('should query DynamoDB directly when no cache', async () => {
      const serviceNoCache = new FolderService({ cacheService: null });
      mockQueryItems.mockResolvedValueOnce({
        items: [
          {
            PK: 'USER#user-123',
            SK: 'FOLDER#f1',
            entityType: 'FOLDER',
            folderId: 'f1',
            folderName: 'Test',
          },
        ],
        lastEvaluatedKey: undefined,
      });

      const result = await serviceNoCache.listContents({
        userId: 'user-123',
        folderId: 'ROOT',
      });

      expect(result.items).toHaveLength(1);
      expect(mockQueryItems).toHaveBeenCalled();
    });
  });
});
