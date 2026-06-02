/**
 * Unit tests for Zod Validation Middleware
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ErrorCode } from '@vaultstream/shared';
import { validate } from './validation';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    body: {},
    query: {},
    params: {},
    requestId: 'test-request-id',
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> {
  return {};
}

function createMockNext(): NextFunction & { mock: { calls: unknown[][] } } {
  return vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('validate middleware', () => {
  describe('body validation', () => {
    const bodySchema = z.object({
      filename: z.string().min(1).max(255),
      sizeBytes: z.number().int().positive(),
    });

    it('should pass validation with valid body', () => {
      const req = createMockRequest({
        body: { filename: 'test.pdf', sizeBytes: 1024 },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: bodySchema })(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body).toEqual({ filename: 'test.pdf', sizeBytes: 1024 });
    });

    it('should return 400 with field-level details on invalid body', () => {
      const req = createMockRequest({
        body: { filename: '', sizeBytes: -5 },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: bodySchema })(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0] as any;
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Request validation failed');
      expect(error.details).toBeDefined();
      expect(error.details.length).toBeGreaterThan(0);
    });

    it('should include field paths in validation details', () => {
      const req = createMockRequest({
        body: { filename: '', sizeBytes: 'not-a-number' },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: bodySchema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      const fields = error.details.map((d: any) => d.field);
      expect(fields).toContain('filename');
      expect(fields).toContain('sizeBytes');
    });

    it('should replace req.body with parsed data (applying defaults/transforms)', () => {
      const schemaWithDefault = z.object({
        name: z.string(),
        limit: z.number().default(20),
      });

      const req = createMockRequest({
        body: { name: 'test' },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: schemaWithDefault })(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body).toEqual({ name: 'test', limit: 20 });
    });
  });

  describe('query validation', () => {
    const querySchema = z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    });

    it('should pass validation with valid query params', () => {
      const req = createMockRequest({
        query: { page: '2', limit: '50' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ query: querySchema })(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query).toEqual({ page: 2, limit: 50 });
    });

    it('should return 400 with query prefix in field paths', () => {
      const req = createMockRequest({
        query: { page: 'abc', limit: '999' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ query: querySchema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      // query fields should be prefixed with "query."
      const fields = error.details.map((d: any) => d.field);
      expect(fields.some((f: string) => f.startsWith('query.'))).toBe(true);
    });
  });

  describe('params validation', () => {
    const paramsSchema = z.object({
      id: z.string().min(1),
    });

    it('should pass validation with valid params', () => {
      const req = createMockRequest({
        params: { id: 'file-123' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ params: paramsSchema })(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.params).toEqual({ id: 'file-123' });
    });

    it('should return 400 with params prefix in field paths', () => {
      const req = createMockRequest({
        params: { id: '' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ params: paramsSchema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      const fields = error.details.map((d: any) => d.field);
      expect(fields.some((f: string) => f.startsWith('params.'))).toBe(true);
    });
  });

  describe('combined validation', () => {
    const bodySchema = z.object({ name: z.string().min(1) });
    const querySchema = z.object({ sort: z.enum(['asc', 'desc']).optional() });
    const paramsSchema = z.object({ id: z.string().min(1) });

    it('should validate body, query, and params together', () => {
      const req = createMockRequest({
        body: { name: 'test' },
        query: { sort: 'asc' } as any,
        params: { id: 'item-1' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: bodySchema, query: querySchema, params: paramsSchema })(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should aggregate errors from multiple sources', () => {
      const req = createMockRequest({
        body: { name: '' },
        query: { sort: 'invalid' } as any,
        params: { id: '' } as any,
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: bodySchema, query: querySchema, params: paramsSchema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.details.length).toBeGreaterThanOrEqual(3);

      const fields = error.details.map((d: any) => d.field);
      expect(fields.some((f: string) => f === 'name' || f.includes('name'))).toBe(true);
      expect(fields.some((f: string) => f.startsWith('query.'))).toBe(true);
      expect(fields.some((f: string) => f.startsWith('params.'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should pass when no schemas are provided', () => {
      const req = createMockRequest({
        body: { anything: 'goes' },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({})(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should include error code from Zod in details', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      const req = createMockRequest({
        body: { email: 'not-an-email' },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: schema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      expect(error.details[0].code).toBeDefined();
      expect(error.details[0].message).toBeDefined();
    });

    it('should handle nested object validation errors', () => {
      const schema = z.object({
        metadata: z.object({
          tags: z.array(z.string().min(1)),
        }),
      });

      const req = createMockRequest({
        body: { metadata: { tags: ['', 'valid'] } },
      }) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      validate({ body: schema })(req, res, next);

      const error = next.mock.calls[0][0] as any;
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      // Should have a nested path like "metadata.tags.0"
      expect(error.details[0].field).toContain('metadata.tags');
    });
  });
});
