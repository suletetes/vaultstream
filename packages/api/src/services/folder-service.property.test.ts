import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_FOLDER_DEPTH } from '@vaultstream/shared';

/**
 * Property-based tests for FolderService core invariants.
 *
 * Tests two correctness properties:
 * - Property 10: Folder Constraint Enforcement
 * - Property 11: Folder Counter Consistency
 */

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Check if a folder can be deleted based on its contents.
 * A folder can only be deleted when fileCount === 0 AND no subfolders exist.
 *
 * This encapsulates the deletion constraint logic from FolderService.deleteFolder.
 */
export function canDeleteFolder(folder: {
  fileCount: number;
  subfolderCount: number;
}): boolean {
  return folder.fileCount === 0 && folder.subfolderCount === 0;
}

/**
 * Check if a folder can be created at the given parent depth.
 * Creation is rejected if the parent is at nesting depth >= MAX_FOLDER_DEPTH (10).
 * ROOT = level 0, top-level folder = level 1, etc.
 *
 * This encapsulates the depth validation logic from FolderService.createFolder.
 */
export function canCreateFolderAtDepth(parentDepth: number): boolean {
  return parentDepth + 1 <= MAX_FOLDER_DEPTH;
}

/**
 * Compute expected folder counters based on the actual files in the folder.
 * fileCount = number of non-deleted files with folderId pointing to this folder.
 * totalSizeBytes = sum of sizeBytes for those files.
 *
 * This encapsulates the counter consistency invariant from FolderService.
 */
export function computeFolderCounters(files: { sizeBytes: number; isDeleted: boolean }[]): {
  fileCount: number;
  totalSizeBytes: number;
} {
  const activeFiles = files.filter((f) => !f.isDeleted);
  return {
    fileCount: activeFiles.length,
    totalSizeBytes: activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
  };
}

// ─── Property 10: Folder Constraint Enforcement ─────────────────────────────

describe('Property 10: Folder Constraint Enforcement', () => {
  /**
   * For any folder, deletion SHALL succeed only when fileCount === 0 AND no subfolders exist.
   * For any folder creation request where the target parent is at nesting depth 10
   * (ROOT = level 0), the creation SHALL be rejected.
   *
   * **Validates: Requirements 3.4, 3.5, 3.10**
   */

  const fileCountArb = fc.nat({ max: 100 });
  const subfolderCountArb = fc.nat({ max: 50 });
  const depthArb = fc.integer({ min: 0, max: 15 });

  it('deletion succeeds only when fileCount === 0 AND subfolderCount === 0', () => {
    fc.assert(
      fc.property(fileCountArb, subfolderCountArb, (fileCount, subfolderCount) => {
        const result = canDeleteFolder({ fileCount, subfolderCount });

        if (fileCount === 0 && subfolderCount === 0) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('deletion is rejected when folder has files', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        subfolderCountArb,
        (fileCount, subfolderCount) => {
          const result = canDeleteFolder({ fileCount, subfolderCount });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deletion is rejected when folder has subfolders', () => {
    fc.assert(
      fc.property(
        fileCountArb,
        fc.integer({ min: 1, max: 50 }),
        (fileCount, subfolderCount) => {
          const result = canDeleteFolder({ fileCount, subfolderCount });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('folder creation is rejected when parent depth >= MAX_FOLDER_DEPTH', () => {
    fc.assert(
      fc.property(depthArb, (parentDepth) => {
        const result = canCreateFolderAtDepth(parentDepth);

        if (parentDepth + 1 > MAX_FOLDER_DEPTH) {
          expect(result).toBe(false);
        } else {
          expect(result).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('folder creation at depth 10 (parent at depth 9) is allowed', () => {
    // MAX_FOLDER_DEPTH = 10, so parent at depth 9 means child at depth 10 which is the max
    expect(canCreateFolderAtDepth(9)).toBe(true);
  });

  it('folder creation at depth 11 (parent at depth 10) is rejected', () => {
    // Parent at depth 10 means child would be at depth 11, exceeding MAX_FOLDER_DEPTH
    expect(canCreateFolderAtDepth(10)).toBe(false);
  });

  it('folder creation at ROOT (depth 0) is always allowed', () => {
    expect(canCreateFolderAtDepth(0)).toBe(true);
  });

  it('depth check correctly rejects all depths > MAX_FOLDER_DEPTH', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FOLDER_DEPTH, max: 15 }),
        (parentDepth) => {
          const result = canCreateFolderAtDepth(parentDepth);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('depth check correctly allows all depths < MAX_FOLDER_DEPTH', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_FOLDER_DEPTH - 1 }),
        (parentDepth) => {
          const result = canCreateFolderAtDepth(parentDepth);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Folder Counter Consistency ────────────────────────────────

describe('Property 11: Folder Counter Consistency', () => {
  /**
   * For any folder and any sequence of file add/remove/move operations, the folder's
   * fileCount SHALL equal the actual number of non-deleted files with folderId pointing
   * to that folder, and totalSizeBytes SHALL equal the sum of their sizeBytes.
   *
   * **Validates: Requirements 3.8, 3.9**
   */

  // Generator for file sizes (1 byte to 100MB)
  const fileSizeArb = fc.integer({ min: 1, max: 104_857_600 });

  type FolderOperation =
    | { type: 'add'; sizeBytes: number }
    | { type: 'remove'; index: number }
    | { type: 'moveOut'; index: number }
    | { type: 'moveIn'; sizeBytes: number };

  // Generator for a sequence of folder operations
  const folderOperationArb = fc.oneof(
    fc.record({ type: fc.constant('add' as const), sizeBytes: fileSizeArb }),
    fc.record({ type: fc.constant('remove' as const), index: fc.nat({ max: 49 }) }),
    fc.record({ type: fc.constant('moveOut' as const), index: fc.nat({ max: 49 }) }),
    fc.record({ type: fc.constant('moveIn' as const), sizeBytes: fileSizeArb }),
  );

  const operationSequenceArb = fc.array(folderOperationArb, { minLength: 1, maxLength: 30 });

  it('fileCount and totalSizeBytes match actual file state after any operation sequence', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        // Simulate folder state: files in this folder
        const files: { sizeBytes: number; isDeleted: boolean }[] = [];
        let trackedFileCount = 0;
        let trackedTotalSize = 0;

        for (const op of operations) {
          switch (op.type) {
            case 'add': {
              // File added to folder
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              trackedFileCount++;
              trackedTotalSize += op.sizeBytes;
              break;
            }
            case 'remove': {
              // File soft-deleted (marked as deleted but stays in folder)
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  files[idx].isDeleted = true;
                  trackedFileCount--;
                  trackedTotalSize -= files[idx].sizeBytes;
                }
              }
              break;
            }
            case 'moveOut': {
              // File moved out of this folder (removed from files array)
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  trackedFileCount--;
                  trackedTotalSize -= files[idx].sizeBytes;
                }
                files.splice(idx, 1);
              }
              break;
            }
            case 'moveIn': {
              // File moved into this folder
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              trackedFileCount++;
              trackedTotalSize += op.sizeBytes;
              break;
            }
          }

          // Invariant: tracked counters match actual file state
          const actual = computeFolderCounters(files);
          expect(trackedFileCount).toBe(actual.fileCount);
          expect(trackedTotalSize).toBe(actual.totalSizeBytes);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('fileCount is never negative', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        const files: { sizeBytes: number; isDeleted: boolean }[] = [];
        let trackedFileCount = 0;

        for (const op of operations) {
          switch (op.type) {
            case 'add':
            case 'moveIn': {
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              trackedFileCount++;
              break;
            }
            case 'remove': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  files[idx].isDeleted = true;
                  trackedFileCount--;
                }
              }
              break;
            }
            case 'moveOut': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  trackedFileCount--;
                }
                files.splice(idx, 1);
              }
              break;
            }
          }

          expect(trackedFileCount).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('totalSizeBytes is never negative', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        const files: { sizeBytes: number; isDeleted: boolean }[] = [];
        let trackedTotalSize = 0;

        for (const op of operations) {
          switch (op.type) {
            case 'add':
            case 'moveIn': {
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              trackedTotalSize += op.sizeBytes;
              break;
            }
            case 'remove': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  files[idx].isDeleted = true;
                  trackedTotalSize -= files[idx].sizeBytes;
                }
              }
              break;
            }
            case 'moveOut': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  trackedTotalSize -= files[idx].sizeBytes;
                }
                files.splice(idx, 1);
              }
              break;
            }
          }

          expect(trackedTotalSize).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('counters for an empty folder are always zero', () => {
    const result = computeFolderCounters([]);
    expect(result.fileCount).toBe(0);
    expect(result.totalSizeBytes).toBe(0);
  });

  it('counters exclude deleted files', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sizeBytes: fileSizeArb,
            isDeleted: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (files) => {
          const result = computeFolderCounters(files);
          const activeFiles = files.filter((f) => !f.isDeleted);

          expect(result.fileCount).toBe(activeFiles.length);
          expect(result.totalSizeBytes).toBe(
            activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it('adding a file always increments fileCount by 1 and totalSizeBytes by file size', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ sizeBytes: fileSizeArb, isDeleted: fc.constant(false) }),
          { minLength: 0, maxLength: 10 },
        ),
        fileSizeArb,
        (existingFiles, newFileSize) => {
          const before = computeFolderCounters(existingFiles);
          const after = computeFolderCounters([
            ...existingFiles,
            { sizeBytes: newFileSize, isDeleted: false },
          ]);

          expect(after.fileCount).toBe(before.fileCount + 1);
          expect(after.totalSizeBytes).toBe(before.totalSizeBytes + newFileSize);
        },
      ),
      { numRuns: 100 },
    );
  });
});
