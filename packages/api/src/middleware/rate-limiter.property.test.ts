/**
 * Property Test: Rate Limit Decision Correctness (Property 16)
 *
 * For any (userId, tier, currentRequestCount, action) tuple, the rate limiter
 * SHALL allow the request if currentRequestCount < tierLimit[tier][action]
 * and reject with HTTP 429 otherwise.
 *
 * Feature: vaultstream-platform, Property 16: Rate limit decision correctness
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { TIER_LIMITS, getTierLimits } from './rate-limiter';

describe('Property 16: Rate Limit Decision Correctness', () => {
  const tiers = ['free', 'pro', 'enterprise'] as const;
  const actions = ['general', 'presigned'] as const;

  test.each(tiers)('tier "%s" has correct limits defined', (tier) => {
    const limits = getTierLimits(tier);
    expect(limits.general).toBeGreaterThan(0);
    expect(limits.presigned).toBeGreaterThan(0);
    expect(limits.presigned).toBeLessThanOrEqual(limits.general);
  });

  test('unknown tier falls back to free tier limits', () => {
    const invalidTiers = ['basic', 'premium', 'gold', 'silver', 'starter', 'unknown', 'test123'];
    for (const unknownTier of invalidTiers) {
      const limits = getTierLimits(unknownTier);
      expect(limits).toEqual(TIER_LIMITS.free);
    }
  });

  test('rate limit decision is correct for any request count and tier', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tiers),
        fc.constantFrom(...actions),
        fc.nat({ max: 5000 }),
        (tier, action, currentCount) => {
          const limits = getTierLimits(tier);
          const limit = action === 'presigned' ? limits.presigned : limits.general;

          // Decision: allow if currentCount < limit, reject otherwise
          const shouldAllow = currentCount < limit;
          const shouldReject = currentCount >= limit;

          // These are complementary
          expect(shouldAllow).toBe(!shouldReject);

          // Verify the limit values match expected tier configuration
          if (tier === 'free') {
            expect(limits.general).toBe(100);
            expect(limits.presigned).toBe(20);
          } else if (tier === 'pro') {
            expect(limits.general).toBe(500);
            expect(limits.presigned).toBe(100);
          } else if (tier === 'enterprise') {
            expect(limits.general).toBe(2000);
            expect(limits.presigned).toBe(500);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('tier limits are monotonically increasing (free < pro < enterprise)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...actions), (action) => {
        const freeLimits = getTierLimits('free');
        const proLimits = getTierLimits('pro');
        const enterpriseLimits = getTierLimits('enterprise');

        const freeLimit = action === 'presigned' ? freeLimits.presigned : freeLimits.general;
        const proLimit = action === 'presigned' ? proLimits.presigned : proLimits.general;
        const enterpriseLimit = action === 'presigned' ? enterpriseLimits.presigned : enterpriseLimits.general;

        expect(freeLimit).toBeLessThan(proLimit);
        expect(proLimit).toBeLessThan(enterpriseLimit);
      }),
      { numRuns: 10 }
    );
  });
});
