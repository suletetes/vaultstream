/**
 * VaultStream Error Handling
 *
 * AppError class, ErrorCode enum, and error response interfaces.
 */

// ─── Error Codes ────────────────────────────────────────────────────────────

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  VERSION_NOT_FOUND = 'VERSION_NOT_FOUND',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  FILE_INFECTED = 'FILE_INFECTED',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// ─── HTTP Status Code Mapping ───────────────────────────────────────────────

export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.FILE_NOT_FOUND]: 404,
  [ErrorCode.VERSION_NOT_FOUND]: 404,
  [ErrorCode.QUOTA_EXCEEDED]: 409,
  [ErrorCode.FILE_INFECTED]: 422,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

// ─── Validation Detail ──────────────────────────────────────────────────────

export interface ValidationDetail {
  field: string;
  message: string;
  code?: string;
}

// ─── Error Response Interface ───────────────────────────────────────────────

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    requestId: string;
    timestamp: string;
    details?: ValidationDetail[];
    retryAfter?: number;
  };
}

// ─── AppError Class ─────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ValidationDetail[];
  public readonly retryAfter?: number;

  constructor(params: {
    code: ErrorCode;
    message: string;
    details?: ValidationDetail[];
    retryAfter?: number;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = ERROR_STATUS_CODES[params.code];
    this.details = params.details;
    this.retryAfter = params.retryAfter;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Serialize the error to the standard error response format.
   */
  toResponse(requestId: string): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        requestId,
        timestamp: new Date().toISOString(),
        ...(this.details && { details: this.details }),
        ...(this.retryAfter !== undefined && { retryAfter: this.retryAfter }),
      },
    };
  }
}

// ─── Factory Functions ──────────────────────────────────────────────────────

export function validationError(message: string, details?: ValidationDetail[]): AppError {
  return new AppError({ code: ErrorCode.VALIDATION_ERROR, message, details });
}

export function unauthorizedError(message = 'Authentication required'): AppError {
  return new AppError({ code: ErrorCode.UNAUTHORIZED, message });
}

export function forbiddenError(message = 'Access denied'): AppError {
  return new AppError({ code: ErrorCode.FORBIDDEN, message });
}

export function fileNotFoundError(message = 'File not found'): AppError {
  return new AppError({ code: ErrorCode.FILE_NOT_FOUND, message });
}

export function versionNotFoundError(message = 'Version not found'): AppError {
  return new AppError({ code: ErrorCode.VERSION_NOT_FOUND, message });
}

export function quotaExceededError(currentUsage: number, limit: number): AppError {
  return new AppError({
    code: ErrorCode.QUOTA_EXCEEDED,
    message: `Storage quota exceeded. Current usage: ${currentUsage} bytes, limit: ${limit} bytes`,
  });
}

export function fileInfectedError(message = 'File is infected with malware'): AppError {
  return new AppError({ code: ErrorCode.FILE_INFECTED, message });
}

export function rateLimitedError(retryAfter: number): AppError {
  return new AppError({
    code: ErrorCode.RATE_LIMITED,
    message: 'Rate limit exceeded',
    retryAfter,
  });
}

export function internalError(message = 'An unexpected error occurred'): AppError {
  return new AppError({ code: ErrorCode.INTERNAL_ERROR, message });
}

export function serviceUnavailableError(retryAfter: number, message = 'Service temporarily unavailable'): AppError {
  return new AppError({
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message,
    retryAfter,
  });
}
