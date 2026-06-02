/**
 * Virus Scanner Lambda Handler Tests
 *
 * Unit tests with mocked AWS SDK calls and child_process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSEvent } from 'aws-lambda';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'GetObject' })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'DeleteObject' })),
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

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PublishCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Publish' })),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  promises: {
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock node:stream/promises
vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:child_process
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:virus-scan-queue',
      awsRegion: 'us-east-1',
    })),
  };
}

function createMessageBody(overrides: Partial<{ bucket: string; key: string; size: number }> = {}) {
  return JSON.stringify({
    bucket: overrides.bucket ?? 'vaultstream-files',
    key: overrides.key ?? 'users/user123/files/file456/1/document.pdf',
    size: overrides.size ?? 1024000,
  });
}

function createMockProcess(exitCode: number) {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };

  // Simulate process events
  proc.on.mockImplementation((event: string, callback: (code: number | null) => void) => {
    if (event === 'close') {
      setTimeout(() => callback(exitCode), 0);
    }
    return proc;
  });

  proc.stdout.on.mockImplementation((_event: string, _callback: (data: Buffer) => void) => {
    return proc.stdout;
  });

  proc.stderr.on.mockImplementation((_event: string, _callback: (data: Buffer) => void) => {
    return proc.stderr;
  });

  return proc;
}

function createMockProcessWithError() {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };

  proc.on.mockImplementation((event: string, callback: (err: Error) => void) => {
    if (event === 'error') {
      setTimeout(() => callback(new Error('spawn ENOENT')), 0);
    }
    return proc;
  });

  proc.stdout.on.mockReturnValue(proc.stdout);
  proc.stderr.on.mockReturnValue(proc.stderr);

  return proc;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Virus Scanner Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: all AWS calls succeed
    mockSend.mockResolvedValue({
      Body: {
        pipe: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('file-content');
        },
      },
    });

    // Default: ClamAV returns clean (exit code 0)
    mockSpawn.mockReturnValue(createMockProcess(0));
  });

  it('should mark file as clean when ClamAV returns exit code 0', async () => {
    mockSpawn.mockReturnValue(createMockProcess(0));

    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    // Should have called UpdateCommand to set virusScanStatus='clean'
    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0]?._type === 'Update',
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should mark file as infected and quarantine when ClamAV returns exit code 1', async () => {
    mockSpawn.mockReturnValue(createMockProcess(1));

    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);

    // Should have called DeleteObjectCommand to add delete marker
    const deleteCalls = mockSend.mock.calls.filter(
      (call) => call[0]?._type === 'DeleteObject',
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should skip files larger than 500MB', async () => {
    const { handler } = await import('./handler');

    const largeSize = 500 * 1024 * 1024 + 1; // Just over 500MB
    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody({ size: largeSize }) },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    // Should NOT spawn clamscan for large files
    expect(mockSpawn).not.toHaveBeenCalled();
    // Should update status to 'skipped'
    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0]?._type === 'Update',
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should not skip files exactly at 500MB', async () => {
    mockSpawn.mockReturnValue(createMockProcess(0));

    const { handler } = await import('./handler');

    const exactSize = 500 * 1024 * 1024; // Exactly 500MB
    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody({ size: exactSize }) },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    // Should spawn clamscan for files at exactly 500MB
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('should report batch item failure when scan returns error', async () => {
    // Exit code 2 = error
    mockSpawn.mockReturnValue(createMockProcess(2));

    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-1');
  });

  it('should treat ClamAV not available as clean (dev environment)', async () => {
    mockSpawn.mockReturnValue(createMockProcessWithError());

    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-1', body: createMessageBody() },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should handle invalid S3 key gracefully', async () => {
    const { handler } = await import('./handler');

    const event = createSQSEvent([
      {
        messageId: 'msg-bad',
        body: JSON.stringify({
          bucket: 'vaultstream-files',
          key: 'invalid/path',
          size: 1024,
        }),
      },
    ]);

    const result = await handler(event);

    // Should not fail — just skip
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should handle multiple records with partial failures', async () => {
    let callIdx = 0;
    mockSpawn.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        return createMockProcess(0); // clean
      }
      return createMockProcess(2); // error
    });

    const { handler } = await import('./handler');

    const event = createSQSEvent([
      { messageId: 'msg-ok', body: createMessageBody({ key: 'users/u1/files/f1/1/a.pdf' }) },
      { messageId: 'msg-fail', body: createMessageBody({ key: 'users/u2/files/f2/1/b.pdf' }) },
    ]);

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-fail');
  });
});
