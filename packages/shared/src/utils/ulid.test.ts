import { describe, it, expect } from 'vitest';
import { generateId, extractTimestamp, isValidUlid } from './ulid';

describe('ULID Generator', () => {
  describe('generateId', () => {
    it('should generate a 26-character string', () => {
      const id = generateId();
      expect(id).toHaveLength(26);
    });

    it('should generate valid Crockford Base32 characters', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('should generate unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });

    it('should generate lexicographically sortable IDs over time', () => {
      const id1 = generateId(1000);
      const id2 = generateId(2000);
      expect(id1 < id2).toBe(true);
    });

    it('should generate monotonically increasing IDs within the same millisecond', () => {
      const now = Date.now();
      const id1 = generateId(now);
      const id2 = generateId(now);
      const id3 = generateId(now);
      expect(id1 < id2).toBe(true);
      expect(id2 < id3).toBe(true);
    });

    it('should accept a seed time parameter', () => {
      const seedTime = Date.now() + 100000; // Use a future time to avoid monotonic override
      const id = generateId(seedTime);
      const extracted = extractTimestamp(id);
      expect(extracted).toBe(seedTime);
    });
  });

  describe('extractTimestamp', () => {
    it('should extract the correct timestamp from a generated ULID', () => {
      // Use a future seed time to ensure the monotonic factory uses it
      const seedTime = Date.now() + 200000;
      const id = generateId(seedTime);
      const timestamp = extractTimestamp(id);
      expect(timestamp).toBe(seedTime);
    });
  });

  describe('isValidUlid', () => {
    it('should return true for a valid ULID', () => {
      const id = generateId();
      expect(isValidUlid(id)).toBe(true);
    });

    it('should return false for strings that are too short', () => {
      expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // 25 chars
    });

    it('should return false for strings that are too long', () => {
      expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAXX')).toBe(false); // 28 chars
    });

    it('should return false for strings with invalid characters (I, L, O, U)', () => {
      expect(isValidUlid('01ARZ3NDIKTSV4RRFFQ69G5FAV')).toBe(false); // contains I
      expect(isValidUlid('01ARZ3NDLKTSV4RRFFQ69G5FAV')).toBe(false); // contains L
      expect(isValidUlid('01ARZ3NDOKTSV4RRFFQ69G5FAV')).toBe(false); // contains O
      expect(isValidUlid('01ARZ3NDUKTSV4RRFFQ69G5FAV')).toBe(false); // contains U
    });

    it('should return false for lowercase strings', () => {
      expect(isValidUlid('01arz3ndektsv4rrffq69g5fav')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidUlid('')).toBe(false);
    });
  });
});
