/**
 * Cognito JWT Authentication Middleware
 *
 * Validates JWT tokens from AWS Cognito using aws-jwt-verify.
 * Extracts userId (sub), email, and role from token claims
 * and attaches them to req.user.
 *
 * Returns HTTP 401 (UNAUTHORIZED) for expired, invalid, or missing tokens.
 */

import { Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { AppError, ErrorCode } from '@vaultstream/shared';

// ─── Verifier Singleton ─────────────────────────────────────────────────────

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!userPoolId || !clientId) {
      throw new Error(
        'COGNITO_USER_POOL_ID and COGNITO_APP_CLIENT_ID environment variables are required'
      );
    }

    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access',
      clientId,
    });
  }
  return verifier;
}

/**
 * Reset the verifier singleton (used in tests).
 */
export function resetVerifier(): void {
  verifier = null;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Express middleware that validates Cognito JWT access tokens.
 *
 * Expects the Authorization header in the format: `Bearer <token>`
 *
 * On success, attaches `req.user` with:
 * - userId: the `sub` claim
 * - email: the `email` claim
 * - role: the `custom:role` claim (defaults to 'user')
 */
export function cognitoAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Missing Authorization header',
        });
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid Authorization header format. Expected: Bearer <token>',
        });
      }

      const token = parts[1];
      const jwtVerifier = getVerifier();
      const payload = await jwtVerifier.verify(token);

      const userId = payload.sub;
      const email = (payload as Record<string, unknown>)['email'] as string || '';
      const role = ((payload as Record<string, unknown>)['custom:role'] as string) || 'user';

      if (role !== 'user' && role !== 'admin') {
        throw new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid role in token claims',
        });
      }

      req.user = {
        userId,
        email,
        role: role as 'user' | 'admin',
      };

      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }

      // Any verification failure (expired, invalid signature, etc.)
      next(
        new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid or expired token',
        })
      );
    }
  };
}
