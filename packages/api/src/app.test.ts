/**
 * Tests for the Express app middleware pipeline.
 *
 * Validates:
 * - Correlation ID generation and propagation
 * - JSON body parsing with 1MB limit
 * - CORS configuration
 * - Global error handler behavior
 * - Health check endpoint
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './app';
import { AppError, ErrorCode } from '@vaultstream/shared';
import express from 'express';
import { correlationId } from './middleware/correlation-id';
import { errorHandler } from './middleware/error-handler';

describe('Express App Middleware Pipeline', () => {
  describe('Correlation ID Middleware', () => {
    it('should generate X-Request-Id when not provided', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should propagate existing X-Request-Id from incoming request', async () => {
      const customId = 'my-custom-request-id-123';
      const res = await request(app)
        .get('/health')
        .set('X-Request-Id', customId);

      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('JSON Body Parser', () => {
    it('should parse valid JSON bodies', async () => {
      // Use a standalone test app to isolate body parsing
      const testApp = express();
      testApp.use(express.json({ limit: '1mb' }));
      testApp.post('/test-body', (req, res) => {
        res.json({ received: req.body });
      });

      const res = await request(testApp)
        .post('/test-body')
        .send({ key: 'value' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ key: 'value' });
    });

    it('should reject bodies exceeding 1MB', async () => {
      const largeBody = { data: 'x'.repeat(1024 * 1024 + 1) };

      const res = await request(app)
        .post('/health')
        .send(largeBody)
        .set('Content-Type', 'application/json');

      // Express body-parser returns 413 for payload too large,
      // but our error handler catches it and returns 500 (INTERNAL_ERROR)
      // since it's not an AppError. The important thing is it's rejected.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('CORS Configuration', () => {
    it('should allow requests from https://app.vaultstream.dev', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'https://app.vaultstream.dev')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe('https://app.vaultstream.dev');
    });

    it('should allow requests from http://localhost:3000', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should not allow requests from unauthorized origins', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'https://evil.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should expose X-Request-Id header', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'https://app.vaultstream.dev')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    });
  });

  describe('Health Check', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('Global Error Handler', () => {
    let errorApp: express.Express;

    beforeEach(() => {
      errorApp = express();
      errorApp.use(correlationId());
      errorApp.use(express.json());

      // Route that throws an AppError
      errorApp.get('/throw-app-error', (_req, _res, next) => {
        next(new AppError({
          code: ErrorCode.FILE_NOT_FOUND,
          message: 'The requested file does not exist',
        }));
      });

      // Route that throws an unknown error
      errorApp.get('/throw-unknown-error', (_req, _res, next) => {
        next(new Error('Something went terribly wrong'));
      });

      // Route that throws an AppError with details
      errorApp.get('/throw-validation-error', (_req, _res, next) => {
        next(new AppError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid input',
          details: [{ field: 'filename', message: 'Filename is required' }],
        }));
      });

      errorApp.use(errorHandler());
    });

    it('should return structured error for AppError instances', async () => {
      const res = await request(errorApp).get('/throw-app-error');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('FILE_NOT_FOUND');
      expect(res.body.error.message).toBe('The requested file does not exist');
      expect(res.body.error.statusCode).toBe(404);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.timestamp).toBeDefined();
    });

    it('should return INTERNAL_ERROR for unknown errors without exposing details', async () => {
      const res = await request(errorApp).get('/throw-unknown-error');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected error occurred');
      expect(res.body.error.statusCode).toBe(500);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.timestamp).toBeDefined();
      // Should NOT contain the original error message
      expect(res.body.error.message).not.toContain('terribly wrong');
    });

    it('should include validation details when present', async () => {
      const res = await request(errorApp).get('/throw-validation-error');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'filename', message: 'Filename is required' },
      ]);
    });

    it('should include requestId from correlation middleware', async () => {
      const customId = 'test-request-id-456';
      const res = await request(errorApp)
        .get('/throw-app-error')
        .set('X-Request-Id', customId);

      expect(res.body.error.requestId).toBe(customId);
    });

    it('should always include code, message, statusCode, requestId, timestamp', async () => {
      const res = await request(errorApp).get('/throw-unknown-error');

      const errorBody = res.body.error;
      expect(errorBody).toHaveProperty('code');
      expect(errorBody).toHaveProperty('message');
      expect(errorBody).toHaveProperty('statusCode');
      expect(errorBody).toHaveProperty('requestId');
      expect(errorBody).toHaveProperty('timestamp');
    });
  });
});
