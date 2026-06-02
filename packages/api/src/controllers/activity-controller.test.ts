/**
 * ActivityController Unit Tests
 *
 * Tests the activity feed endpoint handler:
 * - GET /api/activity returns paginated activity feed
 * - Passes pagination params correctly
 * - Handles errors via next()
 *
 * Validates: Requirements 22.3, 22.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { getActivityFeed } from './activity-controller';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetActivityFeed = vi.fn();

vi.mock('../services/notification-service', () => ({
  notificationService: {
    getActivityFeed: (...args: unknown[]) => mockGetActivityFeed(...args),
  },
}));

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    user: { userId: 'user-123', email: 'test@example.com', role: 'user' },
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ActivityController', () => {
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('getActivityFeed', () => {
    it('should return 200 with activity feed results', async () => {
      const feedResult = {
        items: [
          {
            PK: 'USER#user-123',
            SK: 'ACTIVITY#2025-01-15T00:00:00.000Z',
            entityType: 'ACTIVITY',
            userId: 'user-123',
            eventType: 'file_shared',
            createdAt: '2025-01-15T00:00:00.000Z',
          },
        ],
        hasMore: false,
      };

      mockGetActivityFeed.mockResolvedValueOnce(feedResult);

      const req = createMockRequest();
      await getActivityFeed(req, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(feedResult);
    });

    it('should pass cursor and limit from query params', async () => {
      mockGetActivityFeed.mockResolvedValueOnce({ items: [], hasMore: false });

      const req = createMockRequest({
        query: { cursor: 'abc123', limit: '50' },
      } as unknown as Partial<Request>);

      await getActivityFeed(req, mockRes, mockNext);

      expect(mockGetActivityFeed).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { cursor: 'abc123', limit: 50 },
      });
    });

    it('should pass undefined limit when not provided', async () => {
      mockGetActivityFeed.mockResolvedValueOnce({ items: [], hasMore: false });

      const req = createMockRequest();
      await getActivityFeed(req, mockRes, mockNext);

      expect(mockGetActivityFeed).toHaveBeenCalledWith({
        userId: 'user-123',
        pagination: { cursor: undefined, limit: undefined },
      });
    });

    it('should call next with error when service throws', async () => {
      const error = new Error('Service error');
      mockGetActivityFeed.mockRejectedValueOnce(error);

      const req = createMockRequest();
      await getActivityFeed(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
