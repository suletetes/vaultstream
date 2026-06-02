/**
 * Rate Limiter Middleware
 *
 * Per-user rate limiting using Redis counters with 1-minute sliding windows.
 * Tier-based limits: free (100/min), pro (500/min), enterprise (2000/min).
 * Separate limits for expensive operations (presigned URLs).
 *
 * Fails open when Redis is unavailable (allows requests without limiting).
 *
 * Requirements: 24.1, 24.2, 24.3, 24.4, 24.6, 24.7
 */

import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../cache/redis-client';
import pino from 'pino';

const logger = pino({ name: 'rate-limiter' });

// ─── Tier Limits ────────────────────────────────────────────────────────────

interface TierLimits {
  general: number;
  presigned: number;
}

const TIER_LIMITS: Record<string, TierLimits> = {
  free: { general: 100, presigned: 20 },
  pro: { general: 500, presigned: 100 },
  enterprise: { general: 2000, presigned: 500 },
};

const WINDOW_SECONDS = 60; // 1-minute sliding window

// ─── Helpers ────────────────────────────────────────────────────────────────

function isPresignedOperation(path: string): boolean {
  return path.includes('/upload-url') || path.includes('/download-url') || path.includes('/preview-url');
}

function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Rate limiter middleware factory.
 * Uses Redis INCR + EXPIRE for atomic counter with TTL.
 */
export function rateLimiter() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip if no authenticated user
    const userId = req.user?.userId;
    if (!userId) {
      next();
      return;
    }

    const tier = req.user?.tier || 'free';
    const limits = getTierLimits(tier);
    const isPresigned = isPresignedOperation(req.path);
    const action = isPresigned ? 'presigned' : 'general';
    const limit = isPresigned ? limits.presigned : limits.general;

    const key = `ratelimit:${userId}:${action}`;

    try {
      const redis = getRedisClient();
      if (!redis) {
        // Fail open — allow request when Redis unavailable
        next();
        return;
      }

      // Atomic increment + set TTL if new key
      const current = await redis.incr(key);

      if (current === 1) {
        // First request in window — set expiry
        await redis.expire(key, WINDOW_SECONDS);
      }

      // Get TTL for reset header
      const ttl = await redis.ttl(key);
      const remaining = Math.max(0, limit - current);
      const resetTime = Math.ceil(Date.now() / 1000) + Math.max(ttl, 0);

      // Set rate limit headers on all responses
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', resetTime.toString());

      if (current > limit) {
        // Rate limit exceeded
        const retryAfter = Math.max(ttl, 1);
        res.setHeader('Retry-After', retryAfter.toString());
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            statusCode: 429,
            requestId: req.requestId || 'unknown',
            timestamp: new Date().toISOString(),
            retryAfter,
          },
        });
        return;
      }

      next();
    } catch (error) {
      // Fail open — allow request on Redis errors
      logger.warn({ err: (error as Error).message, userId }, 'Rate limiter Redis error, failing open');
      next();
    }
  };
}

// ─── Exported for testing ───────────────────────────────────────────────────

export { TIER_LIMITS, WINDOW_SECONDS, isPresignedOperation, getTierLimits };
