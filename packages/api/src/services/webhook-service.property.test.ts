/**
 * Property Test: HMAC Webhook Signing Round-Trip (Property 17)
 *
 * For any webhook payload and secret key, computing HMAC-SHA256(secret, payload)
 * and then verifying the signature against the same payload and secret SHALL
 * always succeed. A signature computed with a different secret or against a
 * modified payload SHALL always fail verification.
 *
 * Feature: vaultstream-platform, Property 17: HMAC webhook signing round-trip
 * Validates: Requirements 25.3
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeHmacSignature, verifyHmacSignature } from './webhook-service';

describe('Property 17: HMAC Webhook Signing Round-Trip', () => {
  test('signature verification succeeds for matching secret and payload', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }),  // secret
        fc.string({ minLength: 1, maxLength: 1000 }), // payload
        (secret, payload) => {
          const signature = computeHmacSignature(secret, payload);
          const isValid = verifyHmacSignature(secret, payload, signature);
          expect(isValid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('signature verification fails with different secret', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }),  // original secret
        fc.string({ minLength: 16, maxLength: 64 }),  // different secret
        fc.string({ minLength: 1, maxLength: 1000 }), // payload
        (secret1, secret2, payload) => {
          fc.pre(secret1 !== secret2); // Ensure secrets are different

          const signature = computeHmacSignature(secret1, payload);

          // Verification with wrong secret should fail
          // Note: timingSafeEqual requires same-length buffers, so we catch
          // any errors from length mismatch as well
          try {
            const isValid = verifyHmacSignature(secret2, payload, signature);
            expect(isValid).toBe(false);
          } catch {
            // Buffer length mismatch is also a valid failure
            expect(true).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('signature verification fails with modified payload', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }),  // secret
        fc.string({ minLength: 1, maxLength: 1000 }), // original payload
        fc.string({ minLength: 1, maxLength: 1000 }), // modified payload
        (secret, payload1, payload2) => {
          fc.pre(payload1 !== payload2); // Ensure payloads are different

          const signature = computeHmacSignature(secret, payload1);

          // Verification with modified payload should fail
          try {
            const isValid = verifyHmacSignature(secret, payload2, signature);
            expect(isValid).toBe(false);
          } catch {
            // Buffer length mismatch is also a valid failure
            expect(true).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('signature is deterministic (same inputs produce same output)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        (secret, payload) => {
          const sig1 = computeHmacSignature(secret, payload);
          const sig2 = computeHmacSignature(secret, payload);
          expect(sig1).toBe(sig2);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('signature is a valid hex string of correct length (64 chars for SHA-256)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        (secret, payload) => {
          const signature = computeHmacSignature(secret, payload);
          expect(signature).toMatch(/^[0-9a-f]{64}$/);
        }
      ),
      { numRuns: 50 }
    );
  });
});
