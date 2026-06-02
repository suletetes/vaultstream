/**
 * FolderService — Folder CRUD, Hierarchy Management, and Counters
 *
 * Handles folder operations including:
 * - Create folder with nesting depth validation (max 10 levels)
 * - List folder contents (files + subfolders) with cache-aside pattern
 * - Rename folder with validation
 * - Delete folder (must be empty)
 * - Move file between folders with counter updates
 *
 * Uses GSI2 (FOLDER#{folderId} → name) for folder content queries.
 */

import pino from 'pino';

import { getItem, putItem, queryItems, updateItem, deleteItem } from '../db/base-repository';
import { userPK, folderSK, gsi2Keys } from '../db/key-builders';
import {
  generateId,
  validationError,
  FOLDER_NAME_REGEX,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_DEPTH,
  PAGINATION,
  decodeCursor,
  encodeCursor,
  buildPaginatedResult,
} from '@vaultstream/shared';
import type { FolderEntity, FileEntity, PaginationParams } from '@vaultstream/shared';
import type { CacheService } from '../cache/cache-service';

const logger = pino({ name: 'folder-service' });

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CreateFolderParams {
  userId: string;
  folderName: string;
  parentFolderId?: string;
}

export interface ListContentsParams {
  userId: string;
  folderId: string;
  pagination?: PaginationParams;
}

export interface RenameFolderParams {
  userId: string;
  folderId: string;
  newName: string;
}

export interface DeleteFolderParams {
  userId: string;
  folderId: string;
}

export interface MoveFileParams {
  userId: string;
  fileId: string;
  targetFolderId: string;
}

export interface FolderContentsResult {
  items: (FolderEntity | FileEntity)[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── FolderService Class ────────────────────────────────────────────────────

export class FolderService {
  private readonly cacheService: CacheService | null;

  constructor(deps?: { cacheService?: CacheService | null }) {
    this.cacheService = deps?.cacheService ?? null;
  }

  /**
   * Create a new folder.
   *
   * Flow:
   * 1. Validate folderName with FOLDER_NAME_REGEX (1-255 chars, no /\:*?"<>|)
   * 2. Default parentFolderId to 'ROOT'
   * 3. Check nesting depth: query parent chain up to 10 levels, reject if would exceed MAX_FOLDER_DEPTH
   * 4. Generate folderId via generateId()
   * 5. Store FOLDER entity in DynamoDB
   * 6. Initialize fileCount=0, totalSizeBytes=0
   * 7. Invalidate parent folder cache
   * 8. Return the created folder
   */
  async createFolder(params: CreateFolderParams): Promise<FolderEntity> {
    const { userId, folderName, parentFolderId: rawParentFolderId } = params;
    const parentFolderId = rawParentFolderId ?? 'ROOT';

    // 1. Validate folderName
    this.validateFolderName(folderName);

    // 2. Check nesting depth
    if (parentFolderId !== 'ROOT') {
      const parentDepth = await this.getFolderDepth(userId, parentFolderId);
      if (parentDepth + 1 > MAX_FOLDER_DEPTH) {
        throw validationError('Maximum nesting depth has been exceeded');
      }
    }

    // 3. Generate folderId
    const folderId = generateId();
    const now = new Date().toISOString();

    // 4. Store FOLDER entity
    const folderItem: FolderEntity = {
      PK: userPK(userId),
      SK: folderSK(folderId),
      entityType: 'FOLDER',
      folderId,
      folderName,
      parentFolderId,
      fileCount: 0,
      totalSizeBytes: 0,
      createdAt: now,
      updatedAt: now,
      ...gsi2Keys(parentFolderId, folderName),
    };

    await putItem(folderItem);

    logger.info({ folderId, userId, folderName, parentFolderId }, 'Folder created');

    // 5. Invalidate parent folder cache
    await this.invalidateParentCache(userId, parentFolderId);

    return folderItem;
  }

  /**
   * List folder contents (files + subfolders sorted by name).
   *
   * Flow:
   * 1. Check cache first (user:{userId}:folders:{folderId})
   * 2. On miss: query GSI2 (GSI2PK=FOLDER#{folderId}, sorted by GSI2SK asc) with pagination
   * 3. Filter to only items owned by the user (entityType FILE or FOLDER)
   * 4. Populate cache on miss
   * 5. Return paginated results
   */
  async listContents(params: ListContentsParams): Promise<FolderContentsResult> {
    const { userId, folderId, pagination } = params;
    const limit = pagination?.limit ?? PAGINATION.defaultLimit;
    const cursor = pagination?.cursor;

    // 1. Check cache (only for first page without cursor)
    if (!cursor && this.cacheService) {
      try {
        const cached = await this.cacheService.getFolderContents(userId, folderId);
        if (cached && cached._items) {
          const items = JSON.parse(cached._items) as (FolderEntity | FileEntity)[];
          return buildPaginatedResult(items.slice(0, limit), items.length > limit ? { offset: limit } : null);
        }
      } catch (err) {
        logger.warn({ err, userId, folderId }, 'Failed to get folder contents from cache');
      }
    }

    // 2. Query GSI2
    const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

    const result = await queryItems<FolderEntity | FileEntity>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :gsi2pk',
      expressionAttributeValues: {
        ':gsi2pk': `FOLDER#${folderId}`,
      },
      filterExpression: 'PK = :userPk AND (entityType = :fileType OR entityType = :folderType)',
      expressionAttributeNames: undefined,
      scanIndexForward: true,
      limit: limit + 1,
      exclusiveStartKey,
    });

    // 3. Filter to items owned by the user
    const userPk = userPK(userId);
    const ownedItems = result.items.filter(
      (item) => item.PK === userPk && (item.entityType === 'FILE' || item.entityType === 'FOLDER'),
    );

    // Determine pagination
    const hasMore = ownedItems.length > limit || result.lastEvaluatedKey != null;
    const pageItems = ownedItems.slice(0, limit);
    const nextCursor = result.lastEvaluatedKey ? encodeCursor(result.lastEvaluatedKey) : null;

    // 4. Populate cache on miss (only for first page)
    if (!cursor && this.cacheService && pageItems.length > 0) {
      try {
        await this.cacheService.setFolderContents(userId, folderId, {
          _items: JSON.stringify(pageItems),
        });
      } catch (err) {
        logger.warn({ err, userId, folderId }, 'Failed to set folder contents in cache');
      }
    }

    return {
      items: pageItems,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Rename a folder.
   *
   * Flow:
   * 1. Validate newName with FOLDER_NAME_REGEX
   * 2. Verify folder exists and is owned by user
   * 3. Update folderName and GSI2SK in DynamoDB
   * 4. Invalidate parent folder cache
   */
  async renameFolder(params: RenameFolderParams): Promise<FolderEntity> {
    const { userId, folderId, newName } = params;

    // 1. Validate newName
    this.validateFolderName(newName);

    // 2. Verify folder exists and is owned by user
    const folder = await this.getFolder(userId, folderId);
    if (!folder) {
      throw validationError('Folder not found');
    }

    // 3. Update folderName and GSI2SK
    const now = new Date().toISOString();
    await updateItem(userPK(userId), folderSK(folderId), {
      folderName: newName,
      GSI2SK: newName,
      updatedAt: now,
    });

    logger.info({ folderId, userId, newName }, 'Folder renamed');

    // 4. Invalidate parent folder cache
    await this.invalidateParentCache(userId, folder.parentFolderId);

    return {
      ...folder,
      folderName: newName,
      GSI2SK: newName,
      updatedAt: now,
    };
  }

  /**
   * Delete a folder.
   *
   * Flow:
   * 1. Verify folder exists and is owned by user
   * 2. Check folder is empty: query GSI2 for any items with GSI2PK=FOLDER#{folderId}, limit 1
   * 3. If not empty, throw validationError
   * 4. Delete the FOLDER entity
   * 5. Invalidate parent folder cache
   */
  async deleteFolder(params: DeleteFolderParams): Promise<void> {
    const { userId, folderId } = params;

    // 1. Verify folder exists and is owned by user
    const folder = await this.getFolder(userId, folderId);
    if (!folder) {
      throw validationError('Folder not found');
    }

    // 2. Check folder is empty
    const contents = await queryItems<FolderEntity | FileEntity>({
      indexName: 'GSI2',
      keyConditionExpression: 'GSI2PK = :gsi2pk',
      expressionAttributeValues: {
        ':gsi2pk': `FOLDER#${folderId}`,
      },
      limit: 1,
    });

    if (contents.items.length > 0) {
      throw validationError('Folder must be empty before deletion');
    }

    // 3. Delete the FOLDER entity
    await deleteItem(userPK(userId), folderSK(folderId));

    logger.info({ folderId, userId }, 'Folder deleted');

    // 4. Invalidate parent folder cache
    await this.invalidateParentCache(userId, folder.parentFolderId);
  }

  /**
   * Move a file to a different folder.
   *
   * Flow:
   * 1. Verify target folder exists and is owned by user (or targetFolderId === 'ROOT')
   * 2. Get current file metadata
   * 3. Update file's folderId, GSI2PK, GSI2SK in DynamoDB
   * 4. Update source folder counters (decrement fileCount, subtract sizeBytes)
   * 5. Update target folder counters (increment fileCount, add sizeBytes)
   * 6. Invalidate both folder caches
   */
  async moveFile(params: MoveFileParams): Promise<void> {
    const { userId, fileId, targetFolderId } = params;

    // 1. Verify target folder exists (unless ROOT)
    if (targetFolderId !== 'ROOT') {
      const targetFolder = await this.getFolder(userId, targetFolderId);
      if (!targetFolder) {
        throw validationError('Target folder is invalid');
      }
    }

    // 2. Get current file metadata
    const file = await getItem<FileEntity>(userPK(userId), `FILE#${fileId}`);
    if (!file) {
      throw validationError('File not found');
    }

    const sourceFolderId = file.folderId;

    // Don't move if already in target folder
    if (sourceFolderId === targetFolderId) {
      return;
    }

    // 3. Update file's folderId, GSI2PK, GSI2SK
    const now = new Date().toISOString();
    const newGsi2 = gsi2Keys(targetFolderId, file.filename);

    await updateItem(userPK(userId), `FILE#${fileId}`, {
      folderId: targetFolderId,
      GSI2PK: newGsi2.GSI2PK,
      GSI2SK: newGsi2.GSI2SK,
      updatedAt: now,
    });

    // 4. Update source folder counters (decrement)
    if (sourceFolderId !== 'ROOT') {
      await this.updateFolderCounters(userId, sourceFolderId, -1, -file.sizeBytes);
    }

    // 5. Update target folder counters (increment)
    if (targetFolderId !== 'ROOT') {
      await this.updateFolderCounters(userId, targetFolderId, 1, file.sizeBytes);
    }

    logger.info({ fileId, userId, sourceFolderId, targetFolderId }, 'File moved');

    // 6. Invalidate both folder caches
    await this.invalidateParentCache(userId, sourceFolderId);
    await this.invalidateParentCache(userId, targetFolderId);
  }

  // ─── Helper Methods ─────────────────────────────────────────────────────────

  /**
   * Get the nesting depth of a folder by recursively querying parent folders.
   * ROOT = level 0, top-level folder = level 1, etc.
   */
  async getFolderDepth(userId: string, folderId: string): Promise<number> {
    let depth = 0;
    let currentFolderId = folderId;

    while (currentFolderId !== 'ROOT' && depth <= MAX_FOLDER_DEPTH) {
      const folder = await getItem<FolderEntity>(userPK(userId), folderSK(currentFolderId));
      if (!folder) {
        // If parent doesn't exist, treat as top-level
        break;
      }
      depth++;
      currentFolderId = folder.parentFolderId;
    }

    return depth;
  }

  /**
   * Get a folder entity by userId and folderId.
   */
  private async getFolder(userId: string, folderId: string): Promise<FolderEntity | null> {
    return getItem<FolderEntity>(userPK(userId), folderSK(folderId));
  }

  /**
   * Validate a folder name against FOLDER_NAME_REGEX and length constraints.
   */
  private validateFolderName(name: string): void {
    if (!name || name.length === 0) {
      throw validationError('Folder name is required');
    }
    if (name.length > MAX_FOLDER_NAME_LENGTH) {
      throw validationError(`Folder name must not exceed ${MAX_FOLDER_NAME_LENGTH} characters`);
    }
    if (!FOLDER_NAME_REGEX.test(name)) {
      throw validationError('Folder name contains invalid characters (/ \\ : * ? " < > | are not allowed)');
    }
  }

  /**
   * Update folder counters (fileCount and totalSizeBytes).
   */
  private async updateFolderCounters(
    userId: string,
    folderId: string,
    fileCountDelta: number,
    sizeDelta: number,
  ): Promise<void> {
    try {
      const folder = await this.getFolder(userId, folderId);
      if (!folder) return;

      const newFileCount = Math.max(0, folder.fileCount + fileCountDelta);
      const newTotalSize = Math.max(0, folder.totalSizeBytes + sizeDelta);

      await updateItem(userPK(userId), folderSK(folderId), {
        fileCount: newFileCount,
        totalSizeBytes: newTotalSize,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err, userId, folderId, fileCountDelta, sizeDelta }, 'Failed to update folder counters');
    }
  }

  /**
   * Invalidate the cache for a folder.
   */
  private async invalidateParentCache(userId: string, folderId: string): Promise<void> {
    if (!this.cacheService) return;

    try {
      await this.cacheService.invalidateFolderCache(userId, folderId);
    } catch (err) {
      logger.warn({ err, userId, folderId }, 'Failed to invalidate folder cache');
    }
  }
}

// ─── Default singleton instance ─────────────────────────────────────────────

export const folderService = new FolderService();
