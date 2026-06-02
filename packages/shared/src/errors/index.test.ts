import { describe, it, expect } from 'vitest';
import {
  AppError,
  ErrorCode,
  ERROR_STATUS_CODES,
  validationError,
  unauthorizedError,
  forbiddenError,
  fileNotFoundError,
  versionNotFoundError,
  quotaExceededError,
  fileInfectedError,
  rateLimitedError,
  internalError,
  serviceUnavailableError,
} from './index';

describe('ErrorCode enum', () => {
  it('has all expected error codes', () => {
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN');
    expect(ErrorCode.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
    expect(ErrorCode.VERSION_NOT_FOUND).toBe('VERSION_NOT_FOUND');
    expect(ErrorCode.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
    expect(ErrorCode.FILE_INFECTED).toBe('FILE_INFECTED');
    expect(ErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('ERROR_STATUS_CODES', () => {
  it('maps error codes to correct HTTP status codes', () => {
    expect(ERROR_STATUS_CODES[ErrorCode.VALIDATION_ERROR]).toBe(400);
    expect(ERROR_STATUS_CODES[ErrorCode.UNAUTHORIZED]).toBe(401);
    expect(ERROR_STATUS_CODES[ErrorCode.FORBIDDEN]).toBe(403);
    expect(ERROR_STATUS_CODES[ErrorCode.FILE_NOT_FOUND]).toBe(404);
    expect(ERROR_STATUS_CODES[ErrorCode.VERSION_NOT_FOUND]).toBe(404);
    expect(ERROR_STATUS_CODES[ErrorCode.QUOTA_EXCEEDED]).toBe(409);
    expect(ERROR_STATUS_CODES[ErrorCode.FILE_INFECTED]).toBe(422);
    expect(ERROR_STATUS_CODES[ErrorCode.RATE_LIMITED]).toBe(429);
    expect(ERROR_STATUS_CODES[ErrorCode.INTERNAL_ERROR]).toBe(500);
    expect(ERROR_STATUS_CODES[ErrorCode.SERVICE_UNAVAILABLE]).toBe(503);
  });
});

describe('AppError', () => {
  it('creates an error with correct properties', () => {
    const error = new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid input',
      details: [{ field: 'filename', message: 'Required' }],
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid input');
    expect(error.details).toEqual([{ field: 'filename', message: 'Required' }]);
    expect(error.name).toBe('AppError');
  });

  it('serializes to error response format', () => {
    const error = new AppError({
      code: ErrorCode.RATE_LIMITED,
      message: 'Rate limit exceeded',
      retryAfter: 60,
    });

    const response = error.toResponse('req-123');

    expect(response.error.code).toBe('RATE_LIMITED');
    expect(response.error.message).toBe('Rate limit exceeded');
    expect(response.error.statusCode).toBe(429);
    expect(response.error.requestId).toBe('req-123');
    expect(response.error.timestamp).toBeDefined();
    expect(response.error.retryAfter).toBe(60);
    expect(response.error.details).toBeUndefined();
  });

  it('omits optional fields when not provided', () => {
    const error = new AppError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong',
    });

    const response = error.toResponse('req-456');

    expect(response.error.details).toBeUndefined();
    expect(response.error.retryAfter).toBeUndefined();
  });
});

describe('Factory functions', () => {
  it('validationError creates correct error', () => {
    const error = validationError('Bad input', [{ field: 'email', message: 'Invalid' }]);
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.details).toHaveLength(1);
  });

  it('unauthorizedError creates correct error', () => {
    const error = unauthorizedError();
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Authentication required');
  });

  it('forbiddenError creates correct error', () => {
    const error = forbiddenError();
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    expect(error.statusCode).toBe(403);
  });

  it('fileNotFoundError creates correct error', () => {
    const error = fileNotFoundError();
    expect(error.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(error.statusCode).toBe(404);
  });

  it('versionNotFoundError creates correct error', () => {
    const error = versionNotFoundError();
    expect(error.code).toBe(ErrorCode.VERSION_NOT_FOUND);
    expect(error.statusCode).toBe(404);
  });

  it('quotaExceededError includes usage details in message', () => {
    const error = quotaExceededError(4_000_000_000, 5_368_709_120);
    expect(error.code).toBe(ErrorCode.QUOTA_EXCEEDED);
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('4000000000');
    expect(error.message).toContain('5368709120');
  });

  it('fileInfectedError creates correct error', () => {
    const error = fileInfectedError();
    expect(error.code).toBe(ErrorCode.FILE_INFECTED);
    expect(error.statusCode).toBe(422);
  });

  it('rateLimitedError includes retryAfter', () => {
    const error = rateLimitedError(30);
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.statusCode).toBe(429);
    expect(error.retryAfter).toBe(30);
  });

  it('internalError creates correct error', () => {
    const error = internalError();
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.statusCode).toBe(500);
  });

  it('serviceUnavailableError includes retryAfter', () => {
    const error = serviceUnavailableError(5);
    expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(error.statusCode).toBe(503);
    expect(error.retryAfter).toBe(5);
  });
});
