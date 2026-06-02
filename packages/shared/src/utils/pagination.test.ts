import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  clampLimit,
  normalizePaginationParams,
  encodeCursor,
  decodeCursor,
  buildPaginatedResult,
} from './pagination';

describe('Pagination Helpers', () => {
  describe('constants', () => {
    it('should have default limit of 20', () => {
      expect(DEFAULT_PAGE_LIMIT).toBe(20);
    });

    it('should have max limit of 100', () => {
      expect(MAX_PAGE_LIMIT).toBe(100);
    });
  });

  describe('clampLimit', () => {
    it('should return DEFAULT_PAGE_LIMIT for undefined', () => {
      expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    });

    it('should return DEFAULT_PAGE_LIMIT for NaN', () => {
      expect(clampLimit(NaN)).toBe(DEFAULT_PAGE_LIMIT);
    });

    it('should return DEFAULT_PAGE_LIMIT for Infinity', () => {
      expect(clampLimit(Infinity)).toBe(DEFAULT_PAGE_LIMIT);
    });

    it('should clamp values below 1 to 1', () => {
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(-5)).toBe(1);
    });

    it('should clamp values above MAX_PAGE_LIMIT to MAX_PAGE_LIMIT', () => {
      expect(clampLimit(101)).toBe(MAX_PAGE_LIMIT);
      expect(clampLimit(500)).toBe(MAX_PAGE_LIMIT);
    });

    it('should pass through valid values', () => {
      expect(clampLimit(1)).toBe(1);
      expect(clampLimit(50)).toBe(50);
      expect(clampLimit(100)).toBe(100);
    });

    it('should floor decimal values', () => {
      expect(clampLimit(10.7)).toBe(10);
      expect(clampLimit(20.9)).toBe(20);
    });
  });

  describe('normalizePaginationParams', () => {
    it('should return defaults when no params provided', () => {
      const result = normalizePaginationParams();
      expect(result.limit).toBe(DEFAULT_PAGE_LIMIT);
      expect(result.cursor).toBeUndefined();
    });

    it('should normalize limit and pass through cursor', () => {
      const result = normalizePaginationParams({ limit: 50, cursor: 'abc123' });
      expect(result.limit).toBe(50);
      expect(result.cursor).toBe('abc123');
    });

    it('should clamp excessive limit', () => {
      const result = normalizePaginationParams({ limit: 200 });
      expect(result.limit).toBe(MAX_PAGE_LIMIT);
    });
  });

  describe('encodeCursor / decodeCursor', () => {
    it('should round-trip a simple object', () => {
      const payload = { PK: 'USER#123', SK: 'FILE#456' };
      const encoded = encodeCursor(payload);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it('should round-trip complex payloads', () => {
      const payload = {
        PK: 'USER#abc',
        SK: 'FILE#def',
        GSI1PK: 'USER#abc',
        GSI1SK: '2024-01-15T10:30:00.000Z',
      };
      const encoded = encodeCursor(payload);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it('should produce URL-safe base64 strings', () => {
      const payload = { key: 'value with special chars: +/=' };
      const encoded = encodeCursor(payload);
      // base64url should not contain +, /, or =
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('should return undefined for invalid cursor strings', () => {
      expect(decodeCursor('')).toBeUndefined();
      expect(decodeCursor('not-valid-base64!!!')).toBeUndefined();
      expect(decodeCursor('bnVsbA')).toBeUndefined(); // "null" in base64
    });

    it('should return undefined for non-object JSON', () => {
      // Encode an array
      const arrayEncoded = Buffer.from(JSON.stringify([1, 2, 3]), 'utf-8').toString('base64url');
      expect(decodeCursor(arrayEncoded)).toBeUndefined();

      // Encode a string
      const stringEncoded = Buffer.from(JSON.stringify('hello'), 'utf-8').toString('base64url');
      expect(decodeCursor(stringEncoded)).toBeUndefined();
    });
  });

  describe('buildPaginatedResult', () => {
    it('should build result with no more pages', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const result = buildPaginatedResult(items, null);
      expect(result.items).toEqual(items);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('should build result with next page cursor', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const nextKey = { PK: 'USER#123', SK: 'FILE#456' };
      const result = buildPaginatedResult(items, nextKey);
      expect(result.items).toEqual(items);
      expect(result.nextCursor).not.toBeNull();
      expect(result.hasMore).toBe(true);

      // Verify cursor decodes back to the key
      const decoded = decodeCursor(result.nextCursor!);
      expect(decoded).toEqual(nextKey);
    });

    it('should handle undefined nextKeyPayload as no more pages', () => {
      const result = buildPaginatedResult([], undefined);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('should handle empty items array', () => {
      const result = buildPaginatedResult([], null);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });
});
