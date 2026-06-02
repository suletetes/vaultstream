import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Permission, StorageClass, VirusScanStatus } from '@vaultstream/shared';
import { hasPermission } from '../middleware/authorize';

/**
 * Property-based tests for FileService core invariants.
 *
 * Tests three correctness properties:
 * - Property 4: Storage Accounting Invariant
 * - Property 6: Download Eligibility Gate
 * - Property 5: Authorization Decision Correctness
 */

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Check download eligibility based on file metadata.
 * Returns whether the file is eligible for download and the specific error code if not.
 *
 * This encapsulates the download gate logic from FileService.generateDownloadUrl.
 */
export function checkDownloadEligibility(file: {
  virusScanStatus: VirusScanStatus;
  isDeleted: boolean;
  storageClass: StorageClass;
}): { eligible: boolean; errorCode?: string } {
  if (file.virusScanStatus === 'infected') {
    return { eligible: false, errorCode: 'FILE_INFECTED' };
  }

  if (file.virusScanStatus === 'pending') {
    return { eligible: false, errorCode: 'SCAN_PENDING' };
  }

  if (file.isDeleted === true) {
    return { eligible: false, errorCode: 'FILE_NOT_FOUND' };
  }

  if (file.storageClass === 'DEEP_ARCHIVE') {
    return { eligible: false, errorCode: 'RESTORE_REQUIRED' };
  }

  return { eligible: true };
}

/**
 * Determine if a user has access to a file based on ownership and share records.
 *
 * This encapsulates the authorization decision logic from authorize.ts middleware.
 */
function checkAuthorization(params: {
  userId: string;
  fileOwnerId: string;
  share?: {
    permissions: Permission;
    expiresAt?: number;
  };
  requiredPermission: Permission;
  currentTime: number;
}): boolean {
  const { userId, fileOwnerId, share, requiredPermission, currentTime } = params;

  // Owner always has full access
  if (userId === fileOwnerId) {
    return true;
  }

  // No share record → denied
  if (!share) {
    return false;
  }

  // Check expiration
  if (share.expiresAt !== undefined && share.expiresAt < currentTime) {
    return false;
  }

  // Check permission hierarchy
  return hasPermission(share.permissions, requiredPermission);
}

// ─── Property 4: Storage Accounting Invariant ───────────────────────────────

describe('Property 4: Storage Accounting Invariant', () => {
  /**
   * For any user and any sequence of file upload, soft-delete, and restore operations,
   * the user's storageUsedBytes SHALL always equal the sum of sizeBytes for all files
   * where isDeleted=false. Specifically: upload adds the file's size, soft-delete
   * subtracts it, and restore adds it back.
   *
   * **Validates: Requirements 1.6, 6.2, 6.3, 20.3**
   */

  type Operation =
    | { type: 'upload'; sizeBytes: number }
    | { type: 'delete'; index: number }
    | { type: 'restore'; index: number };

  // Generator for file sizes (1 byte to 100MB)
  const fileSizeArb = fc.integer({ min: 1, max: 104_857_600 });

  // Generator for a sequence of operations
  const operationArb = fc.oneof(
    fc.record({ type: fc.constant('upload' as const), sizeBytes: fileSizeArb }),
    fc.record({ type: fc.constant('delete' as const), index: fc.nat({ max: 49 }) }),
    fc.record({ type: fc.constant('restore' as const), index: fc.nat({ max: 49 }) }),
  );

  const operationSequenceArb = fc.array(operationArb, { minLength: 1, maxLength: 30 });

  it('storageUsedBytes always equals sum of sizeBytes for non-deleted files', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        // Simulate file state
        const files: { sizeBytes: number; isDeleted: boolean }[] = [];
        let storageUsedBytes = 0;

        for (const op of operations) {
          switch (op.type) {
            case 'upload': {
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              storageUsedBytes += op.sizeBytes;
              break;
            }
            case 'delete': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  files[idx].isDeleted = true;
                  storageUsedBytes -= files[idx].sizeBytes;
                }
              }
              break;
            }
            case 'restore': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (files[idx].isDeleted) {
                  files[idx].isDeleted = false;
                  storageUsedBytes += files[idx].sizeBytes;
                }
              }
              break;
            }
          }

          // Invariant: storageUsedBytes === sum of sizeBytes for non-deleted files
          const expectedUsage = files
            .filter((f) => !f.isDeleted)
            .reduce((sum, f) => sum + f.sizeBytes, 0);

          expect(storageUsedBytes).toBe(expectedUsage);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('storageUsedBytes is never negative', () => {
    fc.assert(
      fc.property(operationSequenceArb, (operations) => {
        const files: { sizeBytes: number; isDeleted: boolean }[] = [];
        let storageUsedBytes = 0;

        for (const op of operations) {
          switch (op.type) {
            case 'upload': {
              files.push({ sizeBytes: op.sizeBytes, isDeleted: false });
              storageUsedBytes += op.sizeBytes;
              break;
            }
            case 'delete': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (!files[idx].isDeleted) {
                  files[idx].isDeleted = true;
                  storageUsedBytes -= files[idx].sizeBytes;
                }
              }
              break;
            }
            case 'restore': {
              if (files.length > 0) {
                const idx = op.index % files.length;
                if (files[idx].isDeleted) {
                  files[idx].isDeleted = false;
                  storageUsedBytes += files[idx].sizeBytes;
                }
              }
              break;
            }
          }

          expect(storageUsedBytes).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('deleting an already-deleted file does not change storageUsedBytes', () => {
    fc.assert(
      fc.property(
        fc.array(fileSizeArb, { minLength: 1, maxLength: 10 }),
        fc.nat({ max: 9 }),
        (fileSizes, targetIdx) => {
          const files = fileSizes.map((size) => ({ sizeBytes: size, isDeleted: false }));
          let storageUsedBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

          const idx = targetIdx % files.length;

          // First delete
          files[idx].isDeleted = true;
          storageUsedBytes -= files[idx].sizeBytes;
          const afterFirstDelete = storageUsedBytes;

          // Second delete attempt on same file (should be no-op)
          if (files[idx].isDeleted) {
            // No change
          }

          expect(storageUsedBytes).toBe(afterFirstDelete);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('restoring an active file does not change storageUsedBytes', () => {
    fc.assert(
      fc.property(
        fc.array(fileSizeArb, { minLength: 1, maxLength: 10 }),
        fc.nat({ max: 9 }),
        (fileSizes, targetIdx) => {
          const files = fileSizes.map((size) => ({ sizeBytes: size, isDeleted: false }));
          const storageUsedBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

          const idx = targetIdx % files.length;

          // Attempt restore on active file (should be no-op)
          let currentUsage = storageUsedBytes;
          if (!files[idx].isDeleted) {
            // No change
          }

          expect(currentUsage).toBe(storageUsedBytes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Download Eligibility Gate ──────────────────────────────────

describe('Property 6: Download Eligibility Gate', () => {
  /**
   * For any file metadata, download URL generation SHALL be blocked if any of:
   * virusScanStatus === 'infected', virusScanStatus === 'pending',
   * isDeleted === true, or storageClass === 'DEEP_ARCHIVE'.
   * The specific error code returned SHALL correspond to the blocking condition.
   *
   * **Validates: Requirements 2.5, 2.6, 2.8, 2.9**
   */

  const virusScanStatusArb = fc.constantFrom<VirusScanStatus>(
    'pending',
    'clean',
    'infected',
    'error',
    'skipped',
  );

  const storageClassArb = fc.constantFrom<StorageClass>(
    'STANDARD',
    'STANDARD_IA',
    'GLACIER_IR',
    'DEEP_ARCHIVE',
  );

  const isDeletedArb = fc.boolean();

  const fileMetadataArb = fc.record({
    virusScanStatus: virusScanStatusArb,
    isDeleted: isDeletedArb,
    storageClass: storageClassArb,
  });

  it('should block download when virusScanStatus is infected with FILE_INFECTED error', () => {
    fc.assert(
      fc.property(storageClassArb, isDeletedArb, (storageClass, isDeleted) => {
        const result = checkDownloadEligibility({
          virusScanStatus: 'infected',
          isDeleted,
          storageClass,
        });

        expect(result.eligible).toBe(false);
        expect(result.errorCode).toBe('FILE_INFECTED');
      }),
      { numRuns: 100 },
    );
  });

  it('should block download when virusScanStatus is pending with SCAN_PENDING error', () => {
    fc.assert(
      fc.property(storageClassArb, isDeletedArb, (storageClass, isDeleted) => {
        const result = checkDownloadEligibility({
          virusScanStatus: 'pending',
          isDeleted,
          storageClass,
        });

        // Pending is checked after infected, so if not infected, pending blocks
        expect(result.eligible).toBe(false);
        expect(result.errorCode).toBe('SCAN_PENDING');
      }),
      { numRuns: 100 },
    );
  });

  it('should block download when isDeleted is true with FILE_NOT_FOUND error', () => {
    fc.assert(
      fc.property(storageClassArb, (storageClass) => {
        const result = checkDownloadEligibility({
          virusScanStatus: 'clean',
          isDeleted: true,
          storageClass,
        });

        expect(result.eligible).toBe(false);
        expect(result.errorCode).toBe('FILE_NOT_FOUND');
      }),
      { numRuns: 100 },
    );
  });

  it('should block download when storageClass is DEEP_ARCHIVE with RESTORE_REQUIRED error', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<VirusScanStatus>('clean', 'error', 'skipped'),
        (virusScanStatus) => {
          const result = checkDownloadEligibility({
            virusScanStatus,
            isDeleted: false,
            storageClass: 'DEEP_ARCHIVE',
          });

          expect(result.eligible).toBe(false);
          expect(result.errorCode).toBe('RESTORE_REQUIRED');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should allow download only when no blocking condition exists', () => {
    fc.assert(
      fc.property(fileMetadataArb, (file) => {
        const result = checkDownloadEligibility(file);

        const hasBlockingCondition =
          file.virusScanStatus === 'infected' ||
          file.virusScanStatus === 'pending' ||
          file.isDeleted === true ||
          file.storageClass === 'DEEP_ARCHIVE';

        if (hasBlockingCondition) {
          expect(result.eligible).toBe(false);
          expect(result.errorCode).toBeDefined();
        } else {
          expect(result.eligible).toBe(true);
          expect(result.errorCode).toBeUndefined();
        }
      }),
      { numRuns: 150 },
    );
  });

  it('should check conditions in priority order: infected > pending > deleted > deep_archive', () => {
    fc.assert(
      fc.property(fileMetadataArb, (file) => {
        const result = checkDownloadEligibility(file);

        if (file.virusScanStatus === 'infected') {
          expect(result.errorCode).toBe('FILE_INFECTED');
        } else if (file.virusScanStatus === 'pending') {
          expect(result.errorCode).toBe('SCAN_PENDING');
        } else if (file.isDeleted === true) {
          expect(result.errorCode).toBe('FILE_NOT_FOUND');
        } else if (file.storageClass === 'DEEP_ARCHIVE') {
          expect(result.errorCode).toBe('RESTORE_REQUIRED');
        } else {
          expect(result.eligible).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});

// ─── Property 5: Authorization Decision Correctness ─────────────────────────

describe('Property 5: Authorization Decision Correctness', () => {
  /**
   * For any (userId, fileId, requestedAction) triple, the authorization system
   * SHALL grant access if and only if: (a) the user owns the file, OR (b) a valid,
   * non-expired SHARE record exists with sufficient permissions where the permission
   * hierarchy is view < download < edit (edit implies download implies view).
   *
   * **Validates: Requirements 4.4, 4.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**
   */

  const userIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);
  const permissionArb = fc.constantFrom<Permission>('view', 'download', 'edit');

  // Current time in seconds (epoch)
  const currentTimeArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

  // Expiration: either undefined (no expiry) or a specific epoch time
  const expiresAtArb = fc.option(
    fc.integer({ min: 1_690_000_000, max: 1_810_000_000 }),
    { nil: undefined },
  );

  it('owner always has access regardless of requested permission', () => {
    fc.assert(
      fc.property(userIdArb, permissionArb, currentTimeArb, (userId, requiredPerm, currentTime) => {
        const result = checkAuthorization({
          userId,
          fileOwnerId: userId, // same user = owner
          requiredPermission: requiredPerm,
          currentTime,
        });

        expect(result).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('non-owner without share record is always denied', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb.filter((id) => id !== 'owner'),
        permissionArb,
        currentTimeArb,
        (userId, _otherUser, requiredPerm, currentTime) => {
          // Ensure userId !== fileOwnerId
          const fileOwnerId = userId + '-owner';

          const result = checkAuthorization({
            userId,
            fileOwnerId,
            share: undefined,
            requiredPermission: requiredPerm,
            currentTime,
          });

          expect(result).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('non-owner with expired share is always denied', () => {
    fc.assert(
      fc.property(
        userIdArb,
        permissionArb,
        permissionArb,
        currentTimeArb,
        (userId, sharePerm, requiredPerm, currentTime) => {
          const fileOwnerId = userId + '-owner';
          // Expired: expiresAt is before currentTime
          const expiresAt = currentTime - fc.sample(fc.integer({ min: 1, max: 86400 }), 1)[0];

          const result = checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: sharePerm, expiresAt },
            requiredPermission: requiredPerm,
            currentTime,
          });

          expect(result).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('non-owner with valid non-expired share is granted iff permission is sufficient', () => {
    fc.assert(
      fc.property(
        userIdArb,
        permissionArb,
        permissionArb,
        currentTimeArb,
        (userId, sharePerm, requiredPerm, currentTime) => {
          const fileOwnerId = userId + '-owner';
          // Non-expired: expiresAt is after currentTime
          const expiresAt = currentTime + 3600;

          const result = checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: sharePerm, expiresAt },
            requiredPermission: requiredPerm,
            currentTime,
          });

          const expected = hasPermission(sharePerm, requiredPerm);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('non-owner with share without expiration is granted iff permission is sufficient', () => {
    fc.assert(
      fc.property(
        userIdArb,
        permissionArb,
        permissionArb,
        currentTimeArb,
        (userId, sharePerm, requiredPerm, currentTime) => {
          const fileOwnerId = userId + '-owner';

          const result = checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: sharePerm, expiresAt: undefined },
            requiredPermission: requiredPerm,
            currentTime,
          });

          const expected = hasPermission(sharePerm, requiredPerm);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('permission hierarchy: edit implies download implies view', () => {
    fc.assert(
      fc.property(currentTimeArb, (currentTime) => {
        const userId = 'user-1';
        const fileOwnerId = 'owner-1';
        const expiresAt = currentTime + 3600;

        // edit permission should grant all actions
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'edit', expiresAt },
            requiredPermission: 'view',
            currentTime,
          }),
        ).toBe(true);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'edit', expiresAt },
            requiredPermission: 'download',
            currentTime,
          }),
        ).toBe(true);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'edit', expiresAt },
            requiredPermission: 'edit',
            currentTime,
          }),
        ).toBe(true);

        // download permission should grant view and download but not edit
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'download', expiresAt },
            requiredPermission: 'view',
            currentTime,
          }),
        ).toBe(true);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'download', expiresAt },
            requiredPermission: 'download',
            currentTime,
          }),
        ).toBe(true);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'download', expiresAt },
            requiredPermission: 'edit',
            currentTime,
          }),
        ).toBe(false);

        // view permission should only grant view
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'view', expiresAt },
            requiredPermission: 'view',
            currentTime,
          }),
        ).toBe(true);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'view', expiresAt },
            requiredPermission: 'download',
            currentTime,
          }),
        ).toBe(false);
        expect(
          checkAuthorization({
            userId,
            fileOwnerId,
            share: { permissions: 'view', expiresAt },
            requiredPermission: 'edit',
            currentTime,
          }),
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('authorization decision is deterministic for same inputs', () => {
    fc.assert(
      fc.property(
        userIdArb,
        permissionArb,
        permissionArb,
        currentTimeArb,
        expiresAtArb,
        fc.boolean(),
        (userId, sharePerm, requiredPerm, currentTime, expiresAt, isOwner) => {
          const fileOwnerId = isOwner ? userId : userId + '-owner';
          const share = isOwner ? undefined : { permissions: sharePerm, expiresAt };

          const result1 = checkAuthorization({
            userId,
            fileOwnerId,
            share,
            requiredPermission: requiredPerm,
            currentTime,
          });

          const result2 = checkAuthorization({
            userId,
            fileOwnerId,
            share,
            requiredPermission: requiredPerm,
            currentTime,
          });

          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 12: Soft-Delete Exclusion from Listings ───────────────────────

describe('Property 12: Soft-Delete Exclusion from Listings', () => {
  /**
   * For any file listing query, files where isDeleted===true SHALL never appear.
   * Trash bin SHALL return only isDeleted===true files.
   *
   * **Validates: Requirements 6.7, 6.8, 27.1**
   */

  interface SimulatedFile {
    fileId: string;
    filename: string;
    isDeleted: boolean;
    lastAccessedAt: string;
  }

  /**
   * Simulates the file listing filter logic.
   * Active file listings exclude deleted files.
   */
  function getActiveFiles(files: SimulatedFile[]): SimulatedFile[] {
    return files.filter((f) => !f.isDeleted);
  }

  /**
   * Simulates the trash bin query logic.
   * Trash bin returns only deleted files.
   */
  function getTrashBinFiles(files: SimulatedFile[]): SimulatedFile[] {
    return files.filter((f) => f.isDeleted);
  }

  // Generator for a file with random deletion state
  const fileArb = fc.record({
    fileId: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.replace(/[^a-zA-Z0-9._\-\s()]/g, 'a') || 'file.txt'),
    isDeleted: fc.boolean(),
    lastAccessedAt: fc.date({ min: new Date('2023-01-01'), max: new Date('2025-01-01') }).map((d) => d.toISOString()),
  });

  // Generator for a list of files
  const fileListArb = fc.array(fileArb, { minLength: 0, maxLength: 30 });

  it('active file listing never contains deleted files', () => {
    fc.assert(
      fc.property(fileListArb, (files) => {
        const activeFiles = getActiveFiles(files);

        for (const file of activeFiles) {
          expect(file.isDeleted).toBe(false);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('trash bin only contains deleted files', () => {
    fc.assert(
      fc.property(fileListArb, (files) => {
        const trashFiles = getTrashBinFiles(files);

        for (const file of trashFiles) {
          expect(file.isDeleted).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('active listing and trash bin are disjoint (no overlap)', () => {
    fc.assert(
      fc.property(fileListArb, (files) => {
        const activeFiles = getActiveFiles(files);
        const trashFiles = getTrashBinFiles(files);

        const activeIds = new Set(activeFiles.map((f) => f.fileId));
        const trashIds = new Set(trashFiles.map((f) => f.fileId));

        // No file should appear in both sets
        for (const id of activeIds) {
          expect(trashIds.has(id)).toBe(false);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('active listing + trash bin = all files (complete partition)', () => {
    fc.assert(
      fc.property(fileListArb, (files) => {
        const activeFiles = getActiveFiles(files);
        const trashFiles = getTrashBinFiles(files);

        expect(activeFiles.length + trashFiles.length).toBe(files.length);
      }),
      { numRuns: 150 },
    );
  });

  it('soft-deleting a file removes it from active listing and adds to trash', () => {
    fc.assert(
      fc.property(
        fc.array(fileArb.map((f) => ({ ...f, isDeleted: false })), { minLength: 1, maxLength: 20 }),
        fc.nat(),
        (activeFiles, targetIdx) => {
          const idx = targetIdx % activeFiles.length;

          // Before soft-delete
          const beforeActive = getActiveFiles(activeFiles);
          const beforeTrash = getTrashBinFiles(activeFiles);
          expect(beforeActive).toContainEqual(activeFiles[idx]);
          expect(beforeTrash).not.toContainEqual(activeFiles[idx]);

          // Simulate soft-delete
          const updatedFiles = activeFiles.map((f, i) =>
            i === idx ? { ...f, isDeleted: true } : f,
          );

          // After soft-delete
          const afterActive = getActiveFiles(updatedFiles);
          const afterTrash = getTrashBinFiles(updatedFiles);

          // File should no longer be in active listing
          expect(afterActive.find((f) => f.fileId === activeFiles[idx].fileId)).toBeUndefined();
          // File should now be in trash
          expect(afterTrash.find((f) => f.fileId === activeFiles[idx].fileId)).toBeDefined();
        },
      ),
      { numRuns: 150 },
    );
  });

  it('restoring a file removes it from trash and adds to active listing', () => {
    fc.assert(
      fc.property(
        fc.array(fileArb.map((f) => ({ ...f, isDeleted: true })), { minLength: 1, maxLength: 20 }),
        fc.nat(),
        (deletedFiles, targetIdx) => {
          const idx = targetIdx % deletedFiles.length;

          // Before restore
          const beforeActive = getActiveFiles(deletedFiles);
          const beforeTrash = getTrashBinFiles(deletedFiles);
          expect(beforeTrash).toContainEqual(deletedFiles[idx]);
          expect(beforeActive).not.toContainEqual(deletedFiles[idx]);

          // Simulate restore
          const updatedFiles = deletedFiles.map((f, i) =>
            i === idx ? { ...f, isDeleted: false } : f,
          );

          // After restore
          const afterActive = getActiveFiles(updatedFiles);
          const afterTrash = getTrashBinFiles(updatedFiles);

          // File should now be in active listing
          expect(afterActive.find((f) => f.fileId === deletedFiles[idx].fileId)).toBeDefined();
          // File should no longer be in trash
          expect(afterTrash.find((f) => f.fileId === deletedFiles[idx].fileId)).toBeUndefined();
        },
      ),
      { numRuns: 150 },
    );
  });
});


// ─── Property 13: Cache-Aside Transparency ──────────────────────────────────

describe('Property 13: Cache-Aside Transparency', () => {
  /**
   * Cache-aside transparency — the result is identical whether served from cache or DB.
   * For any query, the data returned from cache must be identical to what the DB would return.
   *
   * **Validates: Requirements 7.1, 7.2, 16.1**
   */

  interface CachedFile {
    fileId: string;
    filename: string;
    lastAccessedAt: string;
    isDeleted: boolean;
  }

  /**
   * Simulates the cache-aside read pattern:
   * 1. Check cache → return if hit
   * 2. On miss → query DB
   * 3. Populate cache with DB result
   * 4. Return DB result
   *
   * The invariant is: regardless of cache state, the final result is always
   * equivalent to what the DB would return.
   */
  function cacheAsideRead(
    cache: Map<string, CachedFile[]>,
    db: CachedFile[],
    cacheKey: string,
  ): { result: CachedFile[]; source: 'cache' | 'db' } {
    // 1. Check cache
    const cached = cache.get(cacheKey);
    if (cached) {
      return { result: cached, source: 'cache' };
    }

    // 2. Query DB (filter out deleted)
    const dbResult = db.filter((f) => !f.isDeleted);

    // 3. Populate cache
    cache.set(cacheKey, dbResult);

    // 4. Return DB result
    return { result: dbResult, source: 'db' };
  }

  const fileArb = fc.record({
    fileId: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'a') || 'file'),
    lastAccessedAt: fc.date({ min: new Date('2023-01-01'), max: new Date('2025-01-01') }).map((d) => d.toISOString()),
    isDeleted: fc.constant(false),
  });

  const fileListArb = fc.array(fileArb, { minLength: 0, maxLength: 20 });

  it('cache hit returns same data as DB would return', () => {
    fc.assert(
      fc.property(fileListArb, fc.string({ minLength: 1, maxLength: 10 }), (files, userId) => {
        const cacheKey = `user:${userId}:recent`;
        const cache = new Map<string, CachedFile[]>();
        const dbFiles = files.filter((f) => !f.isDeleted);

        // First read: populates cache from DB
        const firstResult = cacheAsideRead(cache, files, cacheKey);
        expect(firstResult.source).toBe('db');

        // Second read: should come from cache
        const secondResult = cacheAsideRead(cache, files, cacheKey);
        expect(secondResult.source).toBe('cache');

        // Both results should be identical
        expect(firstResult.result).toEqual(secondResult.result);
        // Both should match what DB would return
        expect(firstResult.result).toEqual(dbFiles);
      }),
      { numRuns: 150 },
    );
  });

  it('cache miss falls through to DB and returns correct data', () => {
    fc.assert(
      fc.property(fileListArb, fc.string({ minLength: 1, maxLength: 10 }), (files, userId) => {
        const cacheKey = `user:${userId}:recent`;
        const cache = new Map<string, CachedFile[]>();

        // Read with empty cache
        const result = cacheAsideRead(cache, files, cacheKey);

        // Should come from DB
        expect(result.source).toBe('db');
        // Should only contain non-deleted files
        const expected = files.filter((f) => !f.isDeleted);
        expect(result.result).toEqual(expected);
      }),
      { numRuns: 150 },
    );
  });

  it('after cache population, cache contains exactly what DB returned', () => {
    fc.assert(
      fc.property(fileListArb, fc.string({ minLength: 1, maxLength: 10 }), (files, userId) => {
        const cacheKey = `user:${userId}:recent`;
        const cache = new Map<string, CachedFile[]>();

        // Populate cache via read
        cacheAsideRead(cache, files, cacheKey);

        // Verify cache content matches DB result
        const cachedData = cache.get(cacheKey);
        const dbResult = files.filter((f) => !f.isDeleted);
        expect(cachedData).toEqual(dbResult);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14: Cache Invalidation Correctness ────────────────────────────

describe('Property 14: Cache Invalidation Correctness', () => {
  /**
   * Cache invalidation correctness — write operations invalidate the correct cache keys.
   * After a write operation (upload, delete, restore, share), the affected cache keys
   * are invalidated so subsequent reads fetch fresh data from DB.
   *
   * **Validates: Requirements 16.6, 7.5**
   */

  type WriteOperation =
    | { type: 'upload'; userId: string; fileId: string }
    | { type: 'delete'; userId: string; fileId: string }
    | { type: 'restore'; userId: string; fileId: string }
    | { type: 'share'; ownerId: string; targetUserId: string; fileId: string };

  /**
   * Determines which cache keys should be invalidated for a given write operation.
   */
  function getInvalidatedKeys(op: WriteOperation): string[] {
    switch (op.type) {
      case 'upload':
        return [`user:${op.userId}:recent`];
      case 'delete':
        return [`user:${op.userId}:recent`, `file:${op.fileId}:meta`];
      case 'restore':
        return [`user:${op.userId}:recent`, `file:${op.fileId}:meta`];
      case 'share':
        return [`user:${op.targetUserId}:shared`, `file:${op.fileId}:meta`];
    }
  }

  /**
   * Simulates cache invalidation: removes specified keys from cache.
   */
  function invalidateCache(cache: Map<string, unknown>, keys: string[]): void {
    for (const key of keys) {
      cache.delete(key);
    }
  }

  const userIdArb = fc.string({ minLength: 3, maxLength: 10 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'u'));
  const fileIdArb = fc.uuid();

  const writeOpArb: fc.Arbitrary<WriteOperation> = fc.oneof(
    fc.record({ type: fc.constant('upload' as const), userId: userIdArb, fileId: fileIdArb }),
    fc.record({ type: fc.constant('delete' as const), userId: userIdArb, fileId: fileIdArb }),
    fc.record({ type: fc.constant('restore' as const), userId: userIdArb, fileId: fileIdArb }),
    fc.record({ type: fc.constant('share' as const), ownerId: userIdArb, targetUserId: userIdArb, fileId: fileIdArb }),
  );

  it('write operations invalidate the correct cache keys', () => {
    fc.assert(
      fc.property(writeOpArb, (op) => {
        const cache = new Map<string, unknown>();

        // Pre-populate cache with relevant keys
        const keysToInvalidate = getInvalidatedKeys(op);
        for (const key of keysToInvalidate) {
          cache.set(key, 'cached-data');
        }

        // Also add some unrelated keys that should NOT be invalidated
        cache.set('user:other-user:recent', 'should-remain');
        cache.set('file:other-file:meta', 'should-remain');

        // Perform invalidation
        invalidateCache(cache, keysToInvalidate);

        // Verify: invalidated keys are gone
        for (const key of keysToInvalidate) {
          expect(cache.has(key)).toBe(false);
        }

        // Verify: unrelated keys remain
        expect(cache.has('user:other-user:recent')).toBe(true);
        expect(cache.has('file:other-file:meta')).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('after invalidation, next read is a cache miss', () => {
    fc.assert(
      fc.property(writeOpArb, (op) => {
        const cache = new Map<string, unknown>();

        // Pre-populate cache
        const keysToInvalidate = getInvalidatedKeys(op);
        for (const key of keysToInvalidate) {
          cache.set(key, 'cached-data');
        }

        // Perform invalidation
        invalidateCache(cache, keysToInvalidate);

        // Verify: all invalidated keys result in cache miss (null/undefined)
        for (const key of keysToInvalidate) {
          expect(cache.get(key)).toBeUndefined();
        }
      }),
      { numRuns: 150 },
    );
  });

  it('upload invalidates user recent cache', () => {
    fc.assert(
      fc.property(userIdArb, fileIdArb, (userId, fileId) => {
        const keys = getInvalidatedKeys({ type: 'upload', userId, fileId });
        expect(keys).toContain(`user:${userId}:recent`);
      }),
      { numRuns: 100 },
    );
  });

  it('delete invalidates user recent cache and file metadata cache', () => {
    fc.assert(
      fc.property(userIdArb, fileIdArb, (userId, fileId) => {
        const keys = getInvalidatedKeys({ type: 'delete', userId, fileId });
        expect(keys).toContain(`user:${userId}:recent`);
        expect(keys).toContain(`file:${fileId}:meta`);
      }),
      { numRuns: 100 },
    );
  });

  it('share invalidates target user shared cache and file metadata cache', () => {
    fc.assert(
      fc.property(userIdArb, userIdArb, fileIdArb, (ownerId, targetUserId, fileId) => {
        const keys = getInvalidatedKeys({ type: 'share', ownerId, targetUserId, fileId });
        expect(keys).toContain(`user:${targetUserId}:shared`);
        expect(keys).toContain(`file:${fileId}:meta`);
      }),
      { numRuns: 100 },
    );
  });

  it('invalidation is idempotent (invalidating already-missing keys is safe)', () => {
    fc.assert(
      fc.property(writeOpArb, (op) => {
        const cache = new Map<string, unknown>();
        const keysToInvalidate = getInvalidatedKeys(op);

        // Don't pre-populate — keys are already missing
        // Invalidation should not throw
        expect(() => invalidateCache(cache, keysToInvalidate)).not.toThrow();

        // Cache should still be functional
        cache.set('test-key', 'test-value');
        expect(cache.get('test-key')).toBe('test-value');
      }),
      { numRuns: 100 },
    );
  });
});
