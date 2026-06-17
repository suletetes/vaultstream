/**
 * Unit tests for Cognito JWT Authentication Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@vaultstream/shared';

// Mock aws-jwt-verify before importing the middleware
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({
      verify: vi.fn(),
    })),
  },
}));

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { cognitoAuth, resetVerifier } from './auth';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockRequest(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    requestId: 'test-request-id',
  };
}

function createMockResponse(): Partial<Response> {
  return {};
}

function createMockNext(): NextFunction & { mock: { calls: unknown[][] } } {
  return vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('cognitoAuth middleware', () => {
  let mockVerify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetVerifier();

    // Set required env vars
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testPool';
    process.env.COGNITO_APP_CLIENT_ID = 'test-client-id';

    // Setup mock verifier
    mockVerify = vi.fn();
    (CognitoJwtVerifier.create as ReturnType<typeof vi.fn>).mockReturnValue({
      verify: mockVerify,
    });
  });

  it('should return 401 when Authorization header is missing', async () => {
    const req = createMockRequest() as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.message).toBe('Missing Authorization header');
  });

  it('should return 401 when Authorization header has invalid format', async () => {
    const req = createMockRequest('InvalidFormat token123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.message).toContain('Invalid Authorization header format');
  });

  it('should return 401 when token has no Bearer prefix', async () => {
    const req = createMockRequest('token123') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('should return 401 when token verification fails', async () => {
    mockVerify.mockRejectedValue(new Error('Token expired'));

    const req = createMockRequest('Bearer expired-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.message).toBe('Invalid or expired token');
  });

  it('should attach user to request on successful verification', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-123',
      email: 'test@example.com',
      'custom:role': 'user',
    });

    const req = createMockRequest('Bearer valid-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
    expect(req.user).toEqual({
      userId: 'user-123',
      email: 'test@example.com',
      role: 'user',
      tier: 'free',
    });
  });

  it('should default role to "user" when custom:role claim is missing', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-456',
      email: 'admin@example.com',
    });

    const req = createMockRequest('Bearer valid-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      userId: 'user-456',
      email: 'admin@example.com',
      role: 'user',
      tier: 'free',
    });
  });

  it('should extract admin role from custom:role claim', async () => {
    mockVerify.mockResolvedValue({
      sub: 'admin-789',
      email: 'admin@vaultstream.dev',
      'custom:role': 'admin',
    });

    const req = createMockRequest('Bearer admin-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      userId: 'admin-789',
      email: 'admin@vaultstream.dev',
      role: 'admin',
      tier: 'free',
    });
  });

  it('should return 401 when role claim has invalid value', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-999',
      email: 'hacker@example.com',
      'custom:role': 'superadmin',
    });

    const req = createMockRequest('Bearer bad-role-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as any;
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.message).toBe('Invalid role in token claims');
  });

  it('should create verifier with correct config from env vars', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-123',
      email: 'test@example.com',
      'custom:role': 'user',
    });

    const req = createMockRequest('Bearer valid-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
      userPoolId: 'us-east-1_testPool',
      tokenUse: 'access',
      clientId: 'test-client-id',
    });
  });

  it('should default email to empty string when email claim is missing', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-no-email',
    });

    const req = createMockRequest('Bearer valid-token') as Request;
    const res = createMockResponse() as Response;
    const next = createMockNext();

    const middleware = cognitoAuth();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      userId: 'user-no-email',
      email: '',
      role: 'user',
      tier: 'free',
    });
  });
});
