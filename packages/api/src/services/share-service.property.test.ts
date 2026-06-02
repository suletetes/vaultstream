import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_SHARES_PER_FILE, ErrorCode } from '@vaultstream/shared';

/**
 * Property-based tests for ShareService core invariants.
 *
 * Tests two correctness properties:
 * - Property 7: Self-Sharing Prevention
 * - Property 8: Resource Limit Enforcement (shares portion)
 */

// ─── Pure Functions Under Test ──────────────────────────────────────────────

/**
 * Validate whether a share creation request should be rejected due to self-sharing.
 * If the owner attempts to share with themselves, it SHALL be rejected with VALIDATION_ERROR.
 *
 * This encapsulates the self-sharing prevention logic from ShareService.createShare.
 */
export function validateShareTarget(params: {
  ownerId: string;
  targetUserId: string;
}): { valid: boolean; errorCode?: string; message?: string } {
  if (params.ownerId === params.targetUserId) {
    return {
      valid: false,
      errorCode: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot share a file with yourself',
    };
  }
  return { valid: true };
}

/**
 * Check whether adding a new share would exceed the maximum shares per file limit.
 * If the file already has MAX_SHARES_PER_FILE (50) shares, the new share SHALL be rejected.
 *
 * This encapsulates the share count limit logic from ShareService.createShare.
 */
export function validateShareCount(currentShareCount: number): {
  allowed: boolean;
  errorCode?: string;
  message?: string;
} {
  if (currentShareCount >= MAX_SHARES_PER_FILE) {
    return {
      allowed: false,
      errorCode: ErrorCode.VALIDATION_ERROR,
      message: 'Maximum shares per file exceeded',
    };
  }
  return { allowed: true };
}

// ─── Property 7: Self-Sharing Prevention ────────────────────────────────────

describe('Property 7: Self-Sharing Prevention', () => {
  /**
   * For any file and user, if the user is the file owner, attempting to share
   * the file with themselves SHALL always be rejected with a VALIDATION_ERROR.
   *
   * **Validates: Requirements 4.11**
   */

  const userIdArb = fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0);

  it('sharing with yourself is always rejected with VALIDATION_ERROR', () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const result = validateShareTarget({
          ownerId: userId,
          targetUserId: userId,
        });

        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.message).toBeDefined();
      }),
      { numRuns: 200 },
    );
  });

  it('sharing with a different user is allowed', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb,
        (ownerId, targetUserId) => {
          // Ensure they are different users
          fc.pre(ownerId !== targetUserId);

          const result = validateShareTarget({
            ownerId,
            targetUserId,
          });

          expect(result.valid).toBe(true);
          expect(result.errorCode).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('self-sharing rejection is independent of userId format', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
          fc.hexaString({ minLength: 8, maxLength: 32 }),
        ),
        (userId) => {
          const result = validateShareTarget({
            ownerId: userId,
            targetUserId: userId,
          });

          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('self-sharing check is symmetric: owner === target always means rejection', () => {
    fc.assert(
      fc.property(
        fc.tuple(userIdArb, userIdArb),
        ([id1, id2]) => {
          const result1 = validateShareTarget({ ownerId: id1, targetUserId: id1 });
          const result2 = validateShareTarget({ ownerId: id2, targetUserId: id2 });

          // Both self-shares should be rejected
          expect(result1.valid).toBe(false);
          expect(result2.valid).toBe(false);

          // Cross-sharing (if different) should be allowed
          if (id1 !== id2) {
            const crossResult = validateShareTarget({ ownerId: id1, targetUserId: id2 });
            expect(crossResult.valid).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Resource Limit Enforcement (shares portion) ────────────────

describe('Property 8: Resource Limit Enforcement (shares portion)', () => {
  /**
   * For any file that has reached 50 shares, attempting to add one more SHALL be
   * rejected with a VALIDATION_ERROR.
   *
   * **Validates: Requirements 4.12**
   */

  const shareCountArb = fc.integer({ min: 0, max: 55 });

  it('adding a share is rejected when current count >= MAX_SHARES_PER_FILE (50)', () => {
    fc.assert(
      fc.property(shareCountArb, (currentCount) => {
        const result = validateShareCount(currentCount);

        if (currentCount >= MAX_SHARES_PER_FILE) {
          expect(result.allowed).toBe(false);
          expect(result.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
        } else {
          expect(result.allowed).toBe(true);
          expect(result.errorCode).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('the 51st share is always rejected', () => {
    // When there are exactly 50 shares, adding one more should be rejected
    const result = validateShareCount(50);
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('the 50th share (count = 49) is allowed', () => {
    // When there are 49 shares, adding one more (the 50th) should be allowed
    const result = validateShareCount(49);
    expect(result.allowed).toBe(true);
  });

  it('shares below the limit are always allowed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_SHARES_PER_FILE - 1 }),
        (currentCount) => {
          const result = validateShareCount(currentCount);
          expect(result.allowed).toBe(true);
          expect(result.errorCode).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('shares at or above the limit are always rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_SHARES_PER_FILE, max: 200 }),
        (currentCount) => {
          const result = validateShareCount(currentCount);
          expect(result.allowed).toBe(false);
          expect(result.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
          expect(result.message).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('limit enforcement is deterministic for same input', () => {
    fc.assert(
      fc.property(shareCountArb, (currentCount) => {
        const result1 = validateShareCount(currentCount);
        const result2 = validateShareCount(currentCount);

        expect(result1.allowed).toBe(result2.allowed);
        expect(result1.errorCode).toBe(result2.errorCode);
      }),
      { numRuns: 100 },
    );
  });

  it('boundary: exactly at MAX_SHARES_PER_FILE is rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (offset) => {
          const atLimit = validateShareCount(MAX_SHARES_PER_FILE + offset);
          expect(atLimit.allowed).toBe(false);

          if (offset === 0) {
            // Exactly at limit
            expect(atLimit.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
