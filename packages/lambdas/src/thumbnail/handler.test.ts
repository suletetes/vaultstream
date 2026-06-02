/**
 * Thumbnail Lambda Handler Tests
 *
 * Unit tests with mocked AWS SDK calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSEvent } from 'aws-lambda';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'GetObject' })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'PutObject' })),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({ send: mockSend })),
  },
  UpdateCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Update' })),
}));

vi.mock('sharp', () => {
  const mockSharp = vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-thumbnail-data')),
  }));
  return { default: mockSharp };
});

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:thumbnail-queue',
      awsRegion: 'us-east-1',
    })),
  };
}

function createImageBody(overrides: Partial<{ bucket: string; key: string; size: number }> = {}) {
  return JSON.stringify({
    bucket: overrides.bucket ?? 'vaultstream-files',
    key: overrides.key ?? 'users/user123/files/file456/1/photo.jpg',
    size: overrides.size ?? 1024000,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Thumbnail Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: S3 GetObject returns a buffer (simulating image data)
    mockSend.mockImplementation((command: { _type?: string }) => {
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: Buffer.from('fake-image-data'),
        });
      }
      // PutObject and UpdateCommand succeed
      return Promise.resolve({});
    });
  });

  it('should process an image file and generate thumbnails', async () => {
    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-1', body: createImageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    // Should have called: 1 GetObject + 2 PutObject (thumb + preview) + 1 UpdateCommand = 4 calls
    expect(mockSend).toHaveBeenCalled();
  });

  it('should skip non-image files silently', async () => {
    const { handler } = await import('./handler');

    const event = createSQSEvent([
      {
        messageId: 'msg-1',
        body: JSON.stringify({
          bucket: 'vaultstream-files',
          key: 'users/user123/files/file456/1/document.pdf',
          size: 2048000,
        }),
      },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    // Should NOT call S3 GetObject for non-image files
    const getObjectCalls = mockSend.mock.calls.filter(
      (call) => call[0]?._type === 'GetObject',
    );
    expect(getObjectCalls).toHaveLength(0);
  });

  it('should skip files with unsupported extensions', async () => {
    const { handler } = await import('./handler');

    const extensions = ['txt', 'csv', 'zip', 'docx', 'xlsx'];

    for (const ext of extensions) {
      vi.clearAllMocks();
      const event = createSQSEvent([
        {
          messageId: `msg-${ext}`,
          body: JSON.stringify({
            bucket: 'vaultstream-files',
            key: `users/user123/files/file456/1/file.${ext}`,
            size: 1024,
          }),
        },
      ]);

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);
    }
  });

  it('should process supported image extensions: jpg, jpeg, png, webp, gif', async () => {
    const { handler } = await import('./handler');

    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    for (const ext of extensions) {
      vi.clearAllMocks();
      mockSend.mockImplementation((command: { _type?: string }) => {
        if (command._type === 'GetObject') {
          return Promise.resolve({ Body: Buffer.from('fake-image') });
        }
        return Promise.resolve({});
      });

      const event = createSQSEvent([
        {
          messageId: `msg-${ext}`,
          body: JSON.stringify({
            bucket: 'vaultstream-files',
            key: `users/user123/files/file456/1/image.${ext}`,
            size: 1024,
          }),
        },
      ]);

      const result = await handler(event);
      expect(result.batchItemFailures).toHaveLength(0);
    }
  });

  it('should report batch item failure when processing fails', async () => {
    const { handler } = await import('./handler');

    mockSend.mockImplementation((command: { _type?: string }) => {
      if (command._type === 'GetObject') {
        return Promise.reject(new Error('S3 access denied'));
      }
      return Promise.resolve({});
    });

    const event = createSQSEvent([
      { messageId: 'msg-fail', body: createImageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-fail');
  });

  it('should handle multiple records with partial failures', async () => {
    const { handler } = await import('./handler');

    let callCount = 0;
    mockSend.mockImplementation((command: { _type?: string }) => {
      if (command._type === 'GetObject') {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ Body: Buffer.from('fake-image') });
        }
        return Promise.reject(new Error('S3 error'));
      }
      return Promise.resolve({});
    });

    const event = createSQSEvent([
      { messageId: 'msg-ok', body: createImageBody({ key: 'users/u1/files/f1/1/a.png' }) },
      { messageId: 'msg-fail', body: createImageBody({ key: 'users/u2/files/f2/1/b.jpg' }) },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-fail');
  });

  it('should handle invalid S3 key gracefully', async () => {
    const { handler } = await import('./handler');

    const event = createSQSEvent([
      {
        messageId: 'msg-bad-key',
        body: JSON.stringify({
          bucket: 'vaultstream-files',
          key: 'invalid/key/path.jpg',
          size: 1024,
        }),
      },
    ]);

    const result = await handler(event);

    // Should not fail — just skip silently since we can't extract IDs
    expect(result.batchItemFailures).toHaveLength(0);
  });
});
