/**
 * SearchController — Express route handler for search endpoint.
 *
 * Handles:
 * - search: Search files by name, tags, MIME type with pagination
 *
 * Requirements: 18.1
 */

import { Request, Response, NextFunction } from 'express';
import { searchService } from '../services/search-service';

/**
 * GET /api/search
 *
 * Search files by name prefix, tags, and MIME type.
 * Query params: query, tags (comma-separated), mimeType, includeShared, cursor, limit
 */
export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const {
      query,
      tags,
      mimeType,
      includeShared,
      cursor,
      limit,
    } = req.query;

    const result = await searchService.search({
      userId,
      query: query as string | undefined,
      tags: tags ? (tags as string).split(',').map((t) => t.trim()) : undefined,
      mimeType: mimeType as string | undefined,
      includeShared: includeShared === 'true',
      cursor: cursor as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
