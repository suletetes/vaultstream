/**
 * Cursor-based pagination helpers.
 *
 * Provides utilities for encoding/decoding opaque cursors and building
 * paginated response structures for DynamoDB-backed queries.
 *
 * @module utils/pagination
 */

/** Default number of items per page */
export const DEFAULT_PAGE_LIMIT = 20;

/** Maximum allowed items per page */
export const MAX_PAGE_LIMIT = 100;

/**
 * Parameters for a paginated query.
 */
export interface PaginationParams {
  /** Opaque cursor from a previous response (base64-encoded). */
  cursor?: string;
  /** Number of items to return. Clamped to [1, MAX_PAGE_LIMIT]. Defaults to DEFAULT_PAGE_LIMIT. */
  limit?: number;
}

/**
 * A paginated result set.
 */
export interface PaginatedResult<T> {
  /** The items for the current page. */
  items: T[];
  /** Opaque cursor for the next page, or null if no more results. */
  nextCursor: string | null;
  /** Whether there are more results available. */
  hasMore: boolean;
}

/**
 * Normalizes pagination parameters, applying defaults and clamping limits.
 *
 * @param params - Raw pagination parameters from the request.
 * @returns Normalized parameters with valid limit and decoded cursor.
 */
export function normalizePaginationParams(params?: PaginationParams): Required<Pick<PaginationParams, 'limit'>> & { cursor?: string } {
  const limit = clampLimit(params?.limit);
  return {
    limit,
    cursor: params?.cursor,
  };
}

/**
 * Clamps a limit value to the valid range [1, MAX_PAGE_LIMIT].
 * Returns DEFAULT_PAGE_LIMIT if the input is undefined or invalid.
 *
 * @param limit - The requested limit.
 * @returns A valid limit value.
 */
export function clampLimit(limit?: number): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (limit < 1) return 1;
  if (limit > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
  return Math.floor(limit);
}

/**
 * Encodes a DynamoDB LastEvaluatedKey (or any cursor payload) into an opaque
 * base64 string for use as a pagination cursor.
 *
 * @param payload - The cursor payload object (e.g., DynamoDB LastEvaluatedKey).
 * @returns A base64url-encoded cursor string.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf-8').toString('base64url');
}

/**
 * Decodes an opaque cursor string back into the original payload object.
 * Returns undefined if the cursor is invalid or cannot be decoded.
 *
 * @param cursor - The base64url-encoded cursor string.
 * @returns The decoded payload, or undefined if invalid.
 */
export function decodeCursor(cursor: string): Record<string, unknown> | undefined {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Builds a PaginatedResult from a list of items and an optional next cursor payload.
 *
 * @param items - The items for the current page.
 * @param nextKeyPayload - The DynamoDB LastEvaluatedKey or null if no more pages.
 * @returns A structured paginated result.
 */
export function buildPaginatedResult<T>(
  items: T[],
  nextKeyPayload: Record<string, unknown> | null | undefined,
): PaginatedResult<T> {
  const hasMore = nextKeyPayload != null;
  return {
    items,
    nextCursor: hasMore ? encodeCursor(nextKeyPayload) : null,
    hasMore,
  };
}
