import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isValidFilename, sanitizeFilename, containsPathTraversal } from './sanitize';
import { FILENAME_REGEX, FOLDER_NAME_REGEX, MAX_FILENAME_LENGTH, MAX_FOLDER_NAME_LENGTH } from '../constants';

/**
 * Property-based tests for filename and folder name validators.
 *
 * **Validates: Requirements 1.1, 3.1, 3.3, 33.4**
 */

describe('Property Tests: Filename and Folder Name Validators', () => {
  describe('Property 1: Filename Validation Correctness', () => {
    /**
     * **Validates: Requirements 1.1, 33.4**
     *
     * For any input string, the filename validator SHALL accept it if and only if
     * it is 1-255 characters long and contains only alphanumeric characters, dots,
     * hyphens, underscores, spaces, and parentheses.
     */

    const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ()';

    // Generator for valid filenames: 1-255 chars from the safe character set
    const validFilenameArb = fc
      .integer({ min: 1, max: MAX_FILENAME_LENGTH })
      .chain((len) =>
        fc.stringOf(fc.constantFrom(...SAFE_CHARS.split('')), { minLength: len, maxLength: len })
      );

    it('should accept any string composed of only safe characters with length 1-255', () => {
      fc.assert(
        fc.property(validFilenameArb, (filename) => {
          expect(isValidFilename(filename)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject any string longer than 255 characters even if all chars are safe', () => {
      const longSafeFilenameArb = fc
        .integer({ min: 256, max: 500 })
        .chain((len) =>
          fc.stringOf(fc.constantFrom(...SAFE_CHARS.split('')), { minLength: len, maxLength: len })
        );

      fc.assert(
        fc.property(longSafeFilenameArb, (filename) => {
          expect(isValidFilename(filename)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject empty strings', () => {
      expect(isValidFilename('')).toBe(false);
    });

    it('should reject any string containing characters outside the safe set', () => {
      // Characters that are NOT in the safe set (FILENAME_REGEX uses \s which matches all whitespace)
      // So we only include non-whitespace characters that are truly forbidden
      const unsafeChars = '/\\:*?"<>|@#$%^&{}[]~`!;,+=';
      const unsafeCharArb = fc.constantFrom(...unsafeChars.split(''));

      // Generate a string that contains at least one unsafe character
      const filenameWithUnsafeCharArb = fc.tuple(
        fc.stringOf(fc.constantFrom(...SAFE_CHARS.split('')), { minLength: 0, maxLength: 100 }),
        unsafeCharArb,
        fc.stringOf(fc.constantFrom(...SAFE_CHARS.split('')), { minLength: 0, maxLength: 100 })
      ).map(([prefix, unsafeChar, suffix]) => prefix + unsafeChar + suffix);

      fc.assert(
        fc.property(filenameWithUnsafeCharArb, (filename) => {
          // Only test if within length bounds (1-255) to isolate the character check
          if (filename.length >= 1 && filename.length <= 255) {
            expect(isValidFilename(filename)).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('isValidFilename should be equivalent to FILENAME_REGEX + length check for any string', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
          const expectedValid =
            input.length >= 1 &&
            input.length <= MAX_FILENAME_LENGTH &&
            FILENAME_REGEX.test(input);
          expect(isValidFilename(input)).toBe(expectedValid);
        }),
        { numRuns: 100 }
      );
    });

    it('sanitized output should never contain path traversal sequences', () => {
      // Generate arbitrary strings including path traversal patterns
      const inputWithTraversalArb = fc.oneof(
        fc.string({ minLength: 1, maxLength: 300 }),
        fc.constantFrom(
          '../etc/passwd',
          '..\\windows\\system32',
          '....//test.txt',
          'foo/../bar/../baz',
          '..\\..\\..\\secret',
          'normal.txt',
          '../../../../../../etc/shadow'
        ),
        // Generate strings with embedded ../ or ..\
        fc.tuple(
          fc.string({ minLength: 0, maxLength: 50 }),
          fc.constantFrom('../', '..\\'),
          fc.string({ minLength: 0, maxLength: 50 })
        ).map(([a, traversal, b]) => a + traversal + b)
      );

      fc.assert(
        fc.property(inputWithTraversalArb, (input) => {
          const sanitized = sanitizeFilename(input);
          expect(containsPathTraversal(sanitized)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('sanitized output should only contain safe characters or be "unnamed"', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
          const sanitized = sanitizeFilename(input);
          // The result should either be "unnamed" or match the safe filename pattern
          if (sanitized === 'unnamed') {
            return; // valid fallback
          }
          expect(FILENAME_REGEX.test(sanitized)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('sanitized output should never exceed 255 characters', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (input) => {
          const sanitized = sanitizeFilename(input);
          expect(sanitized.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
          expect(sanitized.length).toBeGreaterThanOrEqual(1); // always at least "unnamed"
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Folder Name Validation Correctness', () => {
    /**
     * **Validates: Requirements 3.1, 3.3**
     *
     * For any input string, the folder name validator SHALL accept it if and only if
     * it is 1-255 characters long and does not contain any of the characters / \ : * ? " < > |.
     */

    const FORBIDDEN_FOLDER_CHARS = '/\\:*?"<>|';

    // Generator for valid folder names: 1-255 chars without forbidden characters
    // Use a broad set of characters excluding the forbidden ones
    const validFolderCharsArb = fc.string({ minLength: 1, maxLength: MAX_FOLDER_NAME_LENGTH }).filter(
      (s) => s.length >= 1 && s.length <= MAX_FOLDER_NAME_LENGTH && !FORBIDDEN_FOLDER_CHARS.split('').some((c) => s.includes(c))
    );

    // More targeted generator: alphanumeric + common safe chars for folders
    const safeFolderChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ()!@#$%^&+=~`{}[]';
    const validFolderNameArb = fc
      .integer({ min: 1, max: MAX_FOLDER_NAME_LENGTH })
      .chain((len) =>
        fc.stringOf(fc.constantFrom(...safeFolderChars.split('')), { minLength: len, maxLength: len })
      );

    /**
     * Helper: validates a folder name using the same logic as the FOLDER_NAME_REGEX + length check.
     */
    function isValidFolderName(name: string): boolean {
      if (name.length < 1 || name.length > MAX_FOLDER_NAME_LENGTH) return false;
      return FOLDER_NAME_REGEX.test(name);
    }

    it('should accept any string of 1-255 chars that does not contain forbidden characters', () => {
      fc.assert(
        fc.property(validFolderNameArb, (folderName) => {
          expect(isValidFolderName(folderName)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject any string containing at least one forbidden character', () => {
      const forbiddenCharArb = fc.constantFrom(...FORBIDDEN_FOLDER_CHARS.split(''));

      // Generate a folder name that contains at least one forbidden character
      const folderNameWithForbiddenArb = fc.tuple(
        fc.stringOf(fc.constantFrom(...safeFolderChars.split('')), { minLength: 0, maxLength: 100 }),
        forbiddenCharArb,
        fc.stringOf(fc.constantFrom(...safeFolderChars.split('')), { minLength: 0, maxLength: 100 })
      ).map(([prefix, forbidden, suffix]) => prefix + forbidden + suffix);

      fc.assert(
        fc.property(folderNameWithForbiddenArb, (folderName) => {
          if (folderName.length >= 1 && folderName.length <= MAX_FOLDER_NAME_LENGTH) {
            expect(isValidFolderName(folderName)).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should reject empty strings', () => {
      expect(isValidFolderName('')).toBe(false);
    });

    it('should reject strings longer than 255 characters', () => {
      const longFolderNameArb = fc
        .integer({ min: 256, max: 500 })
        .chain((len) =>
          fc.stringOf(fc.constantFrom(...safeFolderChars.split('')), { minLength: len, maxLength: len })
        );

      fc.assert(
        fc.property(longFolderNameArb, (folderName) => {
          expect(isValidFolderName(folderName)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('FOLDER_NAME_REGEX + length check should be the complete validation for any string', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
          const expectedValid =
            input.length >= 1 &&
            input.length <= MAX_FOLDER_NAME_LENGTH &&
            FOLDER_NAME_REGEX.test(input);
          expect(isValidFolderName(input)).toBe(expectedValid);
        }),
        { numRuns: 100 }
      );
    });

    it('should accept folder names with unicode characters that are not in the forbidden set', () => {
      // Folder names can contain unicode as long as they don't have forbidden chars
      const unicodeFolderArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
        (s) => s.length >= 1 && !FORBIDDEN_FOLDER_CHARS.split('').some((c) => s.includes(c))
      );

      fc.assert(
        fc.property(unicodeFolderArb, (folderName) => {
          expect(isValidFolderName(folderName)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
