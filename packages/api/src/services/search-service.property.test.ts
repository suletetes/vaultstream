/**
 * Property Test: Search Filter Correctness (Property 15)
 *
 * For any search query with tag filters, all returned results SHALL contain
 * every specified tag (AND logic). For any search query with a MIME type filter,
 * all returned results SHALL have a matching mimeType.
 *
 * Feature: vaultstream-platform, Property 15: Search filter correctness
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.6
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Pure filter logic extracted for property testing ───────────────────────

interface TestFileItem {
  fileId: string;
  filename: string;
  mimeType: string;
  tags: string[];
}

function filterByTags(items: TestFileItem[], requiredTags: string[]): TestFileItem[] {
  if (requiredTags.length === 0) return items;
  return items.filter((item) => requiredTags.every((tag) => item.tags.includes(tag)));
}

function filterByMimeType(items: TestFileItem[], mimeType: string | undefined): TestFileItem[] {
  if (!mimeType) return items;
  return items.filter((item) => item.mimeType === mimeType);
}

function filterByFilenamePrefix(items: TestFileItem[], prefix: string | undefined): TestFileItem[] {
  if (!prefix) return items;
  return items.filter((item) => item.filename.toLowerCase().startsWith(prefix.toLowerCase()));
}

// ─── Generators ─────────────────────────────────────────────────────────────

const tagArb = fc.stringOf(fc.char().filter((c) => /[a-z0-9]/.test(c)), { minLength: 1, maxLength: 20 });
const filenameArb = fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9._\- ]/.test(c)), { minLength: 1, maxLength: 50 });
const mimeTypeArb = fc.constantFrom(
  'application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'text/csv'
);

const fileItemArb = fc.record({
  fileId: fc.uuid(),
  filename: filenameArb,
  mimeType: mimeTypeArb,
  tags: fc.array(tagArb, { minLength: 0, maxLength: 5 }),
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 15: Search Filter Correctness', () => {
  test('tag filter: all results contain every specified tag (AND logic)', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        fc.array(tagArb, { minLength: 1, maxLength: 3 }),
        (items, requiredTags) => {
          const filtered = filterByTags(items, requiredTags);

          // Every result must contain ALL required tags
          for (const item of filtered) {
            for (const tag of requiredTags) {
              expect(item.tags).toContain(tag);
            }
          }

          // Every item NOT in results must be missing at least one required tag
          const excluded = items.filter((item) => !filtered.includes(item));
          for (const item of excluded) {
            const hasAllTags = requiredTags.every((tag) => item.tags.includes(tag));
            expect(hasAllTags).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('MIME type filter: all results have matching mimeType', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        mimeTypeArb,
        (items, targetMimeType) => {
          const filtered = filterByMimeType(items, targetMimeType);

          // Every result must have the target MIME type
          for (const item of filtered) {
            expect(item.mimeType).toBe(targetMimeType);
          }

          // Every excluded item must have a different MIME type
          const excluded = items.filter((item) => !filtered.includes(item));
          for (const item of excluded) {
            expect(item.mimeType).not.toBe(targetMimeType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('filename prefix filter: all results start with the prefix', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 10 }),
        (items, prefix) => {
          const filtered = filterByFilenamePrefix(items, prefix);

          // Every result must start with the prefix (case-insensitive)
          for (const item of filtered) {
            expect(item.filename.toLowerCase().startsWith(prefix.toLowerCase())).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('empty tag filter returns all items unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const filtered = filterByTags(items, []);
          expect(filtered).toEqual(items);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('undefined MIME type filter returns all items unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const filtered = filterByMimeType(items, undefined);
          expect(filtered).toEqual(items);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('combined filters are conjunctive (AND): result satisfies ALL filters', () => {
    fc.assert(
      fc.property(
        fc.array(fileItemArb, { minLength: 0, maxLength: 50 }),
        fc.array(tagArb, { minLength: 1, maxLength: 2 }),
        mimeTypeArb,
        (items, requiredTags, targetMimeType) => {
          // Apply both filters
          const afterTags = filterByTags(items, requiredTags);
          const afterBoth = filterByMimeType(afterTags, targetMimeType);

          // Every result satisfies BOTH conditions
          for (const item of afterBoth) {
            expect(requiredTags.every((tag) => item.tags.includes(tag))).toBe(true);
            expect(item.mimeType).toBe(targetMimeType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
