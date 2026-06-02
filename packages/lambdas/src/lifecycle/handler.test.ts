/**
 * Lifecycle Processor Lambda Handler Tests
 *
 * Unit tests with mocked AWS SDK calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSEvent } from 'aws-lambda';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'DeleteObject' })),
  ListObjectVersionsCommand: vi.fn().mockImplementation((input) => ({
    ...input,
    _type: 'ListObjectVersions',
  })),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({ send: mockSend })),
  },
  UpdateCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Update' })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Delete' })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Query' })),
  BatchWriteCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'BatchWrite' })),
}));

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createSQSEvent(records: Array<{ messageId: string; body: string }>): SQSEvent {
  return {
    Records: records.map((r) => ({
      messageId: r.messageId,
      receiptHandle: 'receipt-handle',
      body: r.body,
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'sender-id',
        ApproximateFirstReceiveTimestamp: '1234567890',
      },
      messageAttributes: {},
      md5OfBody: 'md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:lifecycle-queue',
      awsRegion: 'us-east-1',
    })),
  };
}

function createStorageClassTransitionBody(overrides: Partial<{
  bucket: string;
  key: string;
  storageClass: string;
}> = {}) {
  return JSON.stringify({
    bucket: overrides.bucket ?? 'vaultstream-files',
    key: overrides.key ?? 'users/user123/files/file456/1/document.pdf',
    storageClass: overrides.storageClass ?? 'STANDARD_IA',
  });
}

function createSoftDeletePurgeBody(overrides: Partial<{
  userId: string;
  fileId: string;
}> = {}) {
  return JSON.stringify({
    eventType: 'soft-delete-purge',
    userId: overrides.userId ?? 'user123',
    fileId: overrides.fileId ?? 'file456',
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Lifecycle Processor Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: all AWS calls succeed
    mockSend.mockImplementation((command: { _type?: string }) => {
      if (command._type === 'Query') {
        return Promise.resolve({ Items: [] });
      }
      if (command._type === 'ListObjectVersions') {
        return Promise.resolve({
          Versions: [],
          DeleteMarkers: [],
          NextKeyMarker: undefined,
        });
      }
      return Promise.resolve({});
    });
  });

  describe('Storage Class Transition', () => {
    it('should update storageClass in DynamoDB for STANDARD_IA transition', async () => {
      const { handler } = await import('./handler');

      const event = createSQSEvent([
        {
          messageId: 'msg-1',
          body: createStorageClassTransitionBody({ storageClass: 'STANDARD_IA' }),
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      // Should have called UpdateCommand
      const updateCalls = mockSend.mock.calls.filter(
        (call) => call[0]?._type === 'Update',
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should update storageClass in DynamoDB for GLACIER_IR transition', async () => {
      const { handler } = await import('./handler');

      const event = createSQSEvent([
        {
          messageId: 'msg-1',
          body: createStorageClassTransitionBody({ storageClass: 'GLACIER_IR' }),
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should update storageClass in DynamoDB for DEEP_ARCHIVE transition', async () => {
      const { handler } = await import('./handler');

      const event = createSQSEvent([
        {
          messageId: 'msg-1',
          body: createStorageClassTransitionBody({ storageClass: 'DEEP_ARCHIVE' }),
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should handle EventBridge detail format for storage class events', async () => {
      const { handler } = await import('./handler');

      const event = createSQSEvent([
        {
          messageId: 'msg-1',
          body: JSON.stringify({
            detail: {
              bucket: { name: 'vaultstream-files' },
              object: {
                key: 'users/user123/files/file456/1/doc.pdf',
                'storage-class': 'STANDARD_IA',
              },
            },
          }),
        },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should handle invalid S3 key gracefully', async () => {
      const { handler } = await import('./handler');

      const event = createSQSEvent([
        {
          messageId: 'msg-1',
          body: createStorageClassTransitionBody({ key: 'invalid/path' }),
        },
      ]);

      const result = await handler(event);

      // Should not fail — just skip
      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should report batch item failure when DynamoDB update fails', async () => {
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'Update') {
          return Promise.reject(new Error('ConditionalCheckFailedException'));
        }
        return Promise.resolve({});
      });

      const { handler } = await import('./handler');

      const event = createSQSEvent([
        { messageId: 'msg-fail', body: createStorageClassTransitionBody() },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-fail');
    });
  });

  describe('Soft-Delete Permanent Purge', () => {
    it('should delete FILE item, VERSION records, SHARE records, and S3 versions', async () => {
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'Query') {
          return Promise.resolve({
            Items: [
              { PK: 'FILE#file456', SK: 'VERSION#1' },
              { PK: 'FILE#file456', SK: 'SHARE#user789' },
            ],
          });
        }
        if (command._type === 'ListObjectVersions') {
          return Promise.resolve({
            Versions: [
              { Key: 'users/user123/files/file456/1/doc.pdf', VersionId: 'v1' },
            ],
            DeleteMarkers: [],
            NextKeyMarker: undefined,
          });
        }
        return Promise.resolve({});
      });

      const { handler } = await import('./handler');

      const event = createSQSEvent([
        { messageId: 'msg-1', body: createSoftDeletePurgeBody() },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);

      // Should have called DeleteCommand for the FILE item
      const deleteCalls = mockSend.mock.calls.filter(
        (call) => call[0]?._type === 'Delete',
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

      // Should have called BatchWriteCommand for VERSION/SHARE records
      const batchCalls = mockSend.mock.calls.filter(
        (call) => call[0]?._type === 'BatchWrite',
      );
      expect(batchCalls.length).toBeGreaterThanOrEqual(1);

      // Should have called DeleteObjectCommand for S3 versions
      const s3DeleteCalls = mockSend.mock.calls.filter(
        (call) => call[0]?._type === 'DeleteObject',
      );
      expect(s3DeleteCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle purge with no VERSION or SHARE records', async () => {
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'Query') {
          return Promise.resolve({ Items: [] });
        }
        if (command._type === 'ListObjectVersions') {
          return Promise.resolve({
            Versions: [],
            DeleteMarkers: [],
            NextKeyMarker: undefined,
          });
        }
        return Promise.resolve({});
      });

      const { handler } = await import('./handler');

      const event = createSQSEvent([
        { messageId: 'msg-1', body: createSoftDeletePurgeBody() },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should report batch item failure when purge fails', async () => {
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'Query') {
          return Promise.reject(new Error('DynamoDB error'));
        }
        return Promise.resolve({});
      });

      const { handler } = await import('./handler');

      const event = createSQSEvent([
        { messageId: 'msg-fail', body: createSoftDeletePurgeBody() },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-fail');
    });
  });

  describe('Mixed Events', () => {
    it('should handle multiple records of different types', async () => {
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'Query') {
          return Promise.resolve({ Items: [] });
        }
        if (command._type === 'ListObjectVersions') {
          return Promise.resolve({
            Versions: [],
            DeleteMarkers: [],
            NextKeyMarker: undefined,
          });
        }
        return Promise.resolve({});
      });

      const { handler } = await import('./handler');

      const event = createSQSEvent([
        { messageId: 'msg-transition', body: createStorageClassTransitionBody() },
        { messageId: 'msg-purge', body: createSoftDeletePurgeBody() },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });
  });
});
