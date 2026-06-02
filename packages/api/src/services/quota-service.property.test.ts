import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TIER_QUOTAS } from '@vaultstream/shared';

/**
 * Property-based tests for Quota Check Decision Correctness.
 *
 * **Validates: Requirements 1.8, 20.1, 20.2**
 */

// Mock the DynamoDB document client
const mockSend = vi.fn();
vi.mock('../db/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'vaultstream-metadata',
}));

// Import after mock setup
import { checkQuota } from './quota-service';

describe('Property Tests: Quota Check Decision Correctness', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  /**
   * **Property 3: Quota Check Decision Correctness**
   *
   * For any tuple of (currentStorageUsedBytes, declaredFileSize, tierQuotaLimit),
   * the quota check SHALL return allowed=true if and only if
   * currentStorageUsedBytes + declaredFileSize <= tierQuotaLimit.
   * When allowed=false, the response SHALL include the current usage and limit values.
   *
   * **Validates: Requirements 1.8, 20.1, 20.2**
   */

  const ONE_TB = 1_099_511_627_776;
  const ONE_HUNDRED_MB = 104_857_600;

  // Generator for currentUsage: 0 to 1TB
  const currentUsageArb = fc.integer({ min: 0, max: ONE_TB });

  // Generator for fileSize: 1 byte to 100MB
  const fileSizeArb = fc.integer({ min: 1, max: ONE_HUNDRED_MB });

  // Generator for quotaLimit: one of the three tier values
  const quotaLimitArb = fc.constantFrom(
    TIER_QUOTAS.free,        // 5GB
    TIER_QUOTAS.pro,         // 100GB
    TIER_QUOTAS.enterprise,  // 1TB
  );

  it('should return allowed=true if and only if currentUsage + fileSize <= quotaLimit', async () => {
    await fc.assert(
      fc.asyncProperty(
        currentUsageArb,
        fileSizeArb,
        quotaLimitArb,
        async (currentUsage, fileSize, quotaLimit) => {
          mockSend.mockReset();
          mockSend.mockResolvedValueOnce({
            Item: {
              storageUsedBytes: currentUsage,
              storageQuotaBytes: quotaLimit,
              tier: 'free',
            },
          });

          const result = await checkQuota('test-user', fileSize);

          const expectedAllowed = currentUsage + fileSize <= quotaLimit;
          expect(result.allowed).toBe(expectedAllowed);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always include currentUsage and limit in the response regardless of decision', async () => {
    await fc.assert(
      fc.asyncProperty(
        currentUsageArb,
        fileSizeArb,
        quotaLimitArb,
        async (currentUsage, fileSize, quotaLimit) => {
          mockSend.mockReset();
          mockSend.mockResolvedValueOnce({
            Item: {
              storageUsedBytes: currentUsage,
              storageQuotaBytes: quotaLimit,
              tier: 'pro',
            },
          });

          const result = await checkQuota('test-user', fileSize);

          expect(result.currentUsage).toBe(currentUsage);
          expect(result.limit).toBe(quotaLimit);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should include currentUsage and limit when allowed=false', async () => {
    await fc.assert(
      fc.asyncProperty(
        currentUsageArb,
        fileSizeArb,
        quotaLimitArb,
        async (currentUsage, fileSize, quotaLimit) => {
          mockSend.mockReset();
          mockSend.mockResolvedValueOnce({
            Item: {
              storageUsedBytes: currentUsage,
              storageQuotaBytes: quotaLimit,
              tier: 'enterprise',
            },
          });

          const result = await checkQuota('test-user', fileSize);

          if (!result.allowed) {
            // When denied, the response MUST include usage and limit
            expect(result.currentUsage).toBe(currentUsage);
            expect(result.limit).toBe(quotaLimit);
            // Verify the denial is mathematically correct
            expect(currentUsage + fileSize).toBeGreaterThan(quotaLimit);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return allowed=true at the exact boundary (usage + size === limit)', async () => {
    await fc.assert(
      fc.asyncProperty(
        quotaLimitArb,
        fc.integer({ min: 1, max: ONE_HUNDRED_MB }),
        async (quotaLimit, fileSize) => {
          // Set currentUsage so that currentUsage + fileSize === quotaLimit exactly
          const currentUsage = quotaLimit - fileSize;
          if (currentUsage < 0) return; // skip invalid combos

          mockSend.mockReset();
          mockSend.mockResolvedValueOnce({
            Item: {
              storageUsedBytes: currentUsage,
              storageQuotaBytes: quotaLimit,
              tier: 'free',
            },
          });

          const result = await checkQuota('test-user', fileSize);

          expect(result.allowed).toBe(true);
          expect(result.currentUsage).toBe(currentUsage);
          expect(result.limit).toBe(quotaLimit);
        },
      ),
      { numRuns: 100 },
    );
  });
});
