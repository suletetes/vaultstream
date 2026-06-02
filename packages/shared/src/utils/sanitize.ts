/**
 * Filename sanitization utilities.
 *
 * Strips path traversal sequences and restricts filenames to safe characters
 * to prevent directory traversal attacks and filesystem issues.
 *
 * @module utils/sanitize
 */

/**
 * Regex matching allowed filename characters:
 * alphanumeric, dots, hyphens, underscores, spaces, and parentheses.
 */
const SAFE_FILENAME_CHARS = /[^a-zA-Z0-9._\-\s()]/g;

/**
 * Regex matching path traversal sequences (../ and ..\).
 * Note: Uses a function to avoid stateful regex with the `g` flag.
 */
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/g;

/**
 * Sanitizes a filename by:
 * 1. Stripping path traversal sequences (../ and ..\)
 * 2. Removing any characters not in the safe set (alphanumeric, dots, hyphens, underscores, spaces, parentheses)
 * 3. Collapsing multiple consecutive dots to a single dot (prevents hidden file tricks)
 * 4. Trimming leading/trailing whitespace
 * 5. Returning a fallback name if the result is empty
 *
 * @param filename - The raw filename to sanitize.
 * @returns A sanitized filename safe for storage.
 */
export function sanitizeFilename(filename: string): string {
  let sanitized = filename;

  // Strip path traversal sequences repeatedly until none remain
  let previous = '';
  while (previous !== sanitized) {
    previous = sanitized;
    sanitized = sanitized.replace(PATH_TRAVERSAL_PATTERN, '');
  }

  // Remove unsafe characters
  sanitized = sanitized.replace(SAFE_FILENAME_CHARS, '');

  // Collapse multiple consecutive dots to a single dot
  sanitized = sanitized.replace(/\.{2,}/g, '.');

  // Trim whitespace
  sanitized = sanitized.trim();

  // If nothing remains, provide a fallback
  if (sanitized.length === 0) {
    return 'unnamed';
  }

  // Enforce max length of 255 characters
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }

  return sanitized;
}

/**
 * Checks whether a filename is valid according to VaultStream rules:
 * - 1-255 characters
 * - Only alphanumeric, dots, hyphens, underscores, spaces, and parentheses
 *
 * @param filename - The filename to validate.
 * @returns true if the filename is valid.
 */
export function isValidFilename(filename: string): boolean {
  if (filename.length < 1 || filename.length > 255) return false;
  return /^[a-zA-Z0-9._\-\s()]+$/.test(filename);
}

/**
 * Checks whether a string contains path traversal sequences.
 *
 * @param input - The string to check.
 * @returns true if path traversal sequences are found.
 */
export function containsPathTraversal(input: string): boolean {
  return /\.\.[/\\]/.test(input);
}
