/**
 * ULID (Universally Unique Lexicographically Sortable Identifier) utilities.
 *
 * Uses monotonic factory to guarantee lexicographic ordering even when
 * multiple IDs are generated within the same millisecond.
 *
 * @module utils/ulid
 */

import { monotonicFactory, decodeTime } from 'ulid';

/**
 * Monotonic ULID factory instance.
 * Ensures IDs generated in the same millisecond are still lexicographically ordered.
 */
const ulidFactory = monotonicFactory();

/**
 * Generates a new ULID using the monotonic factory.
 * IDs are guaranteed to be lexicographically sortable by creation time.
 *
 * @param seedTime - Optional timestamp (ms since epoch) to use as the time component.
 * @returns A 26-character ULID string (Crockford Base32 encoded).
 */
export function generateId(seedTime?: number): string {
  return ulidFactory(seedTime);
}

/**
 * Extracts the Unix timestamp (milliseconds) from a ULID.
 *
 * @param id - A valid 26-character ULID string.
 * @returns The timestamp in milliseconds since Unix epoch.
 */
export function extractTimestamp(id: string): number {
  return decodeTime(id);
}

/**
 * Validates whether a string is a well-formed ULID.
 * A valid ULID is exactly 26 characters of Crockford Base32 (uppercase).
 *
 * @param id - The string to validate.
 * @returns true if the string is a valid ULID format.
 */
export function isValidUlid(id: string): boolean {
  if (id.length !== 26) return false;
  // Crockford Base32 alphabet (excludes I, L, O, U)
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}
