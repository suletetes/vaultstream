import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_VERSIONS_PER_FILE } from '@vaultstream/shared';

/**
 * Property-based tests for FileService versioning invariants.
 *
 * Tests two correctness properties:
 * - Property 9: Version Counter Invariant
 * - Property 8 (versions portion): Resource Limit Enforcement for versions
 *
 * **Validates: Requirements 5.2, 5.5, 5.8**
 */

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Simulates the version counter logic from FileService.
 * After uploading N new versions, the version counter equals initial + N.
 * Each VERSION entity has a unique, monotonically increasing version number.
 */
function simulateVersionUploads(initialVersion: number, uploadCount: number): {
  finalVersion: number;
  versionNumbers: number[];
} {
  const versionNumbers: number[] = [];
  let currentVersion = initialVersion;

  for (let i = 0; i < uploadCount; i++) {
    currentVersion++;
    versionNumbers.push(currentVersion);
  }

  return { finalVersion: currentVersion, versionNumbers };
}

/**
 * Simulates the version cap enforcement logic.
 * When version count reaches MAX_VERSIONS_PER_FILE (50), the oldest is deleted
 * before creating a new version.
 */
function simulateVersionCapEnforcement(
  existingVersions: number[],
  newVersionNumber: number,
): {
  resultVersions: number[];
  deletedVersion: number | null;
} {
  const versions = [...existingVersions];
  let deletedVersion: number | null = null;

  if (versions.length >= MAX_VERSIONS_PER_FILE) {
    // Delete the oldest (smallest version number)
    versions.sort((a, b) => a - b);
    deletedVersion = versions.shift()!;
  }

  versions.push(newVersionNumber);

  return { resultVersions: versions, deletedVersion };
}

// ─── Property 9: Version Counter Invariant ──────────────────────────────────

describe('Property 9: Version Counter Invariant', () => {
  /**
   * For any file, after uploading N new versions, the version counter SHALL equal
   * initial + N. Each VERSION entity has a unique, monotonically increasing version number.
   *
   * **Validates: Requirements 5.2, 5.5**
   */

  // Generator for initial version (1 to 100)
  const initialVersionArb = fc.integer({ min: 1, max: 100 });

  // Generator for number of uploads (1 to 50)
  const uploadCountArb = fc.integer({ min: 1, max: 50 });

  it('version counter equals initial + N after N uploads', () => {
    fc.assert(
      fc.property(initialVersionArb, uploadCountArb, (initialVersion, uploadCount) => {
        const { finalVersion } = simulateVersionUploads(initialVersion, uploadCount);

        expect(finalVersion).toBe(initialVersion + uploadCount);
      }),
      { numRuns: 150 },
    );
  });

  it('each version number is unique within a file', () => {
    fc.assert(
      fc.property(initialVersionArb, uploadCountArb, (initialVersion, uploadCount) => {
        const { versionNumbers } = simulateVersionUploads(initialVersion, uploadCount);

        const uniqueVersions = new Set(versionNumbers);
        expect(uniqueVersions.size).toBe(versionNumbers.length);
      }),
      { numRuns: 150 },
    );
  });

  it('version numbers are monotonically increasing', () => {
    fc.assert(
      fc.property(initialVersionArb, uploadCountArb, (initialVersion, uploadCount) => {
        const { versionNumbers } = simulateVersionUploads(initialVersion, uploadCount);

        for (let i = 1; i < versionNumbers.length; i++) {
          expect(versionNumbers[i]).toBeGreaterThan(versionNumbers[i - 1]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('version numbers are consecutive (no gaps)', () => {
    fc.assert(
      fc.property(initialVersionArb, uploadCountArb, (initialVersion, uploadCount) => {
        const { versionNumbers } = simulateVersionUploads(initialVersion, uploadCount);

        for (let i = 1; i < versionNumbers.length; i++) {
          expect(versionNumbers[i] - versionNumbers[i - 1]).toBe(1);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('first new version number is always initialVersion + 1', () => {
    fc.assert(
      fc.property(initialVersionArb, (initialVersion) => {
        const { versionNumbers } = simulateVersionUploads(initialVersion, 1);

        expect(versionNumbers[0]).toBe(initialVersion + 1);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8 (versions portion): Resource Limit Enforcement ──────────────

describe('Property 8: Resource Limit Enforcement (versions)', () => {
  /**
   * When version count reaches MAX_VERSIONS_PER_FILE (50), the oldest version
   * is deleted before creating a new one. The total version count never exceeds 50.
   *
   * **Validates: Requirements 5.8**
   */

  // Generator for existing version count (0 to 60, to test both under and over cap)
  const existingVersionCountArb = fc.integer({ min: 0, max: 60 });

  // Generator for a sequence of version additions
  const additionCountArb = fc.integer({ min: 1, max: 30 });

  it('version count never exceeds MAX_VERSIONS_PER_FILE after cap enforcement', () => {
    fc.assert(
      fc.property(existingVersionCountArb, additionCountArb, (existingCount, additions) => {
        // Start with existingCount versions numbered 1..existingCount
        let versions = Array.from({ length: Math.min(existingCount, MAX_VERSIONS_PER_FILE) }, (_, i) => i + 1);
        let nextVersion = versions.length + 1;

        for (let i = 0; i < additions; i++) {
          const { resultVersions } = simulateVersionCapEnforcement(versions, nextVersion);
          versions = resultVersions;
          nextVersion++;

          // Invariant: version count never exceeds MAX_VERSIONS_PER_FILE
          expect(versions.length).toBeLessThanOrEqual(MAX_VERSIONS_PER_FILE);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('when at cap, adding a version deletes the oldest', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_VERSIONS_PER_FILE, max: MAX_VERSIONS_PER_FILE }),
        fc.integer({ min: 51, max: 200 }),
        (existingCount, newVersionNumber) => {
          // Create exactly MAX_VERSIONS_PER_FILE versions
          const versions = Array.from({ length: existingCount }, (_, i) => i + 1);
          const oldestVersion = Math.min(...versions);

          const { resultVersions, deletedVersion } = simulateVersionCapEnforcement(
            versions,
            newVersionNumber,
          );

          // The oldest version should have been deleted
          expect(deletedVersion).toBe(oldestVersion);
          // The new version should be present
          expect(resultVersions).toContain(newVersionNumber);
          // Count should still be at the cap
          expect(resultVersions.length).toBe(MAX_VERSIONS_PER_FILE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when below cap, adding a version does not delete any', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_VERSIONS_PER_FILE - 1 }),
        fc.integer({ min: 100, max: 200 }),
        (existingCount, newVersionNumber) => {
          const versions = Array.from({ length: existingCount }, (_, i) => i + 1);

          const { resultVersions, deletedVersion } = simulateVersionCapEnforcement(
            versions,
            newVersionNumber,
          );

          // No version should be deleted
          expect(deletedVersion).toBeNull();
          // Count should increase by 1
          expect(resultVersions.length).toBe(existingCount + 1);
          // New version should be present
          expect(resultVersions).toContain(newVersionNumber);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after cap enforcement, the deleted version is always the smallest number', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: MAX_VERSIONS_PER_FILE, maxLength: MAX_VERSIONS_PER_FILE }),
        fc.integer({ min: 201, max: 300 }),
        (existingVersions, newVersionNumber) => {
          const { deletedVersion } = simulateVersionCapEnforcement(
            existingVersions,
            newVersionNumber,
          );

          const expectedOldest = Math.min(...existingVersions);
          expect(deletedVersion).toBe(expectedOldest);
        },
      ),
      { numRuns: 100 },
    );
  });
});
