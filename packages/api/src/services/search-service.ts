/**
 * SearchService — File search by name, tags, and MIME type
 *
 * Supports:
 * - Prefix-based filename search via GSI2SK begins_with
 * - Tag filtering (AND logic — results must contain ALL specified tags)
 * - MIME type filtering
 * - Scoped to user's own files; includes shared files when includeShared=true
 * - Cursor-based pagination (default 20, max 100)
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8
 */

import { getDynamoDBDocClient } from '../db/dynamodb';
import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import pino from 'pino';

const logger = pino({ name: 'search-service' });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'vaultstream-metadata';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchParams {
  userId: string;
  query?: string;
  tags?: string[];
  mimeType?: string;
  includeShared?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  nextCursor?: string;
  total: number;
}

export interface SearchResultItem {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailKey: string | null;
  folderId: string;
  tags: string[];
  storageClass: string;
  virusScanStatus: string;
  lastAccessedAt: string;
  createdAt: string;
  isShared?: boolean;
  sharedBy?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class SearchService {
  /**
   * Search files by name prefix, tags, and MIME type.
   */
  async search(params: SearchParams): Promise<SearchResult> {
    const limit = Math.min(params.limit || 20, 100);
    const results: SearchResultItem[] = [];

    // 1. Search user's own files
    const ownFiles = await this.searchOwnFiles(params, limit);
    results.push(...ownFiles);

    // 2. Optionally search shared files
    if (params.includeShared) {
      const sharedFiles = await this.searchSharedFiles(params, limit);
      results.push(...sharedFiles);
    }

    // 3. Apply tag filtering (AND logic — must contain ALL tags)
    let filtered = results;
    if (params.tags && params.tags.length > 0) {
      filtered = results.filter((item) =>
        params.tags!.every((tag) => item.tags.includes(tag))
      );
    }

    // 4. Apply MIME type filtering
    if (params.mimeType) {
      filtered = filtered.filter((item) => item.mimeType === params.mimeType);
    }

    // 5. Sort by relevance (filename match first, then by lastAccessedAt)
    if (params.query) {
      const queryLower = params.query.toLowerCase();
      filtered.sort((a, b) => {
        const aStartsWith = a.filename.toLowerCase().startsWith(queryLower) ? 0 : 1;
        const bStartsWith = b.filename.toLowerCase().startsWith(queryLower) ? 0 : 1;
        if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;
        return b.lastAccessedAt.localeCompare(a.lastAccessedAt);
      });
    }

    // 6. Apply pagination
    const startIndex = params.cursor ? parseInt(params.cursor, 10) : 0;
    const paginatedItems = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < filtered.length
      ? String(startIndex + limit)
      : undefined;

    return {
      items: paginatedItems,
      nextCursor,
      total: filtered.length,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async searchOwnFiles(params: SearchParams, limit: number): Promise<SearchResultItem[]> {
    const client = getDynamoDBDocClient();

    // Query user's files from the main table
    const queryInput: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${params.userId}`,
        ':skPrefix': 'FILE#',
        ':false': false,
      },
      FilterExpression: 'isDeleted = :false',
      Limit: limit * 3, // Over-fetch to account for filtering
    };

    // Add filename prefix filter if query provided
    if (params.query) {
      queryInput.FilterExpression += ' AND begins_with(filename, :filenamePrefix)';
      queryInput.ExpressionAttributeValues![':filenamePrefix'] = params.query;
    }

    try {
      const result = await client.send(new QueryCommand(queryInput));
      return (result.Items || []).map((item) => this.mapToSearchResult(item, false));
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Failed to search own files');
      return [];
    }
  }

  private async searchSharedFiles(params: SearchParams, limit: number): Promise<SearchResultItem[]> {
    const client = getDynamoDBDocClient();

    // Query shared files via GSI3
    const queryInput: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `USER#${params.userId}`,
      },
      Limit: limit * 2,
      ScanIndexForward: false, // Most recent shares first
    };

    try {
      const result = await client.send(new QueryCommand(queryInput));
      const items = (result.Items || []).map((item) => this.mapToSearchResult(item, true));

      // Apply filename filter for shared files
      if (params.query) {
        const queryLower = params.query.toLowerCase();
        return items.filter((item) =>
          item.filename.toLowerCase().startsWith(queryLower)
        );
      }

      return items;
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Failed to search shared files');
      return [];
    }
  }

  private mapToSearchResult(item: Record<string, unknown>, isShared: boolean): SearchResultItem {
    return {
      fileId: item.fileId as string,
      filename: item.filename as string,
      mimeType: item.mimeType as string,
      sizeBytes: item.sizeBytes as number,
      thumbnailKey: (item.thumbnailKey as string) || null,
      folderId: item.folderId as string,
      tags: (item.tags as string[]) || [],
      storageClass: (item.storageClass as string) || 'STANDARD',
      virusScanStatus: (item.virusScanStatus as string) || 'pending',
      lastAccessedAt: item.lastAccessedAt as string,
      createdAt: item.createdAt as string,
      isShared,
      sharedBy: isShared ? (item.sharedBy as string) : undefined,
    };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const searchService = new SearchService();
