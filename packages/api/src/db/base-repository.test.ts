import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getItem, putItem, queryItems, updateItem, deleteItem, batchWrite } from './base-repository';

// Mock the DynamoDB document client
const mockSend = vi.fn();
vi.mock('./dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'vaultstream-metadata',
}));

describe('base-repository', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('getItem', () => {
    it('should return the item when found', async () => {
      const mockItem = { PK: 'USER#123', SK: 'FILE#abc', filename: 'test.pdf' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await getItem<typeof mockItem>('USER#123', 'FILE#abc');
      expect(result).toEqual(mockItem);

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        TableName: 'vaultstream-metadata',
        Key: { PK: 'USER#123', SK: 'FILE#abc' },
      });
    });

    it('should return null when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getItem('USER#123', 'FILE#missing');
      expect(result).toBeNull();
    });
  });

  describe('putItem', () => {
    it('should put an item into the table', async () => {
      mockSend.mockResolvedValueOnce({});

      const item = { PK: 'USER#123', SK: 'FILE#abc', filename: 'test.pdf' };
      await putItem(item);

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        TableName: 'vaultstream-metadata',
        Item: item,
      });
    });
  });

  describe('queryItems', () => {
    it('should query with key condition and return items', async () => {
      const mockItems = [
        { PK: 'USER#123', SK: 'FILE#a' },
        { PK: 'USER#123', SK: 'FILE#b' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems, LastEvaluatedKey: undefined });

      const result = await queryItems({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        expressionAttributeValues: { ':pk': 'USER#123', ':prefix': 'FILE#' },
      });

      expect(result.items).toEqual(mockItems);
      expect(result.lastEvaluatedKey).toBeUndefined();
    });

    it('should pass optional parameters when provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      await queryItems({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': 'USER#123' },
        scanIndexForward: false,
        limit: 20,
        filterExpression: 'isDeleted = :false',
        expressionAttributeNames: { '#status': 'status' },
        exclusiveStartKey: { PK: 'USER#123', SK: 'FILE#last' },
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.IndexName).toBe('GSI1');
      expect(command.input.ScanIndexForward).toBe(false);
      expect(command.input.Limit).toBe(20);
      expect(command.input.FilterExpression).toBe('isDeleted = :false');
      expect(command.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
      expect(command.input.ExclusiveStartKey).toEqual({ PK: 'USER#123', SK: 'FILE#last' });
    });

    it('should return lastEvaluatedKey for pagination', async () => {
      const lastKey = { PK: 'USER#123', SK: 'FILE#z' };
      mockSend.mockResolvedValueOnce({ Items: [{ PK: 'USER#123' }], LastEvaluatedKey: lastKey });

      const result = await queryItems({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': 'USER#123' },
      });

      expect(result.lastEvaluatedKey).toEqual(lastKey);
    });
  });

  describe('updateItem', () => {
    it('should build SET expression from updates object', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateItem('USER#123', 'FILE#abc', {
        filename: 'renamed.pdf',
        updatedAt: '2024-01-15T10:00:00Z',
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('vaultstream-metadata');
      expect(command.input.Key).toEqual({ PK: 'USER#123', SK: 'FILE#abc' });
      expect(command.input.UpdateExpression).toContain('SET');
      expect(command.input.ExpressionAttributeValues[':filename']).toBe('renamed.pdf');
      expect(command.input.ExpressionAttributeValues[':updatedAt']).toBe('2024-01-15T10:00:00Z');
      expect(command.input.ExpressionAttributeNames['#filename']).toBe('filename');
      expect(command.input.ExpressionAttributeNames['#updatedAt']).toBe('updatedAt');
    });

    it('should do nothing when updates object is empty', async () => {
      await updateItem('USER#123', 'FILE#abc', {});
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('deleteItem', () => {
    it('should delete an item by primary key', async () => {
      mockSend.mockResolvedValueOnce({});

      await deleteItem('USER#123', 'FILE#abc');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        TableName: 'vaultstream-metadata',
        Key: { PK: 'USER#123', SK: 'FILE#abc' },
      });
    });
  });

  describe('batchWrite', () => {
    it('should batch put and delete operations', async () => {
      mockSend.mockResolvedValueOnce({});

      await batchWrite([
        { type: 'put', item: { PK: 'USER#1', SK: 'FILE#a', filename: 'a.pdf' } },
        { type: 'delete', key: { PK: 'USER#1', SK: 'FILE#b' } },
      ]);

      const command = mockSend.mock.calls[0][0];
      const requests = command.input.RequestItems['vaultstream-metadata'];
      expect(requests).toHaveLength(2);
      expect(requests[0].PutRequest).toBeDefined();
      expect(requests[1].DeleteRequest).toBeDefined();
    });

    it('should chunk operations into batches of 25', async () => {
      mockSend.mockResolvedValue({});

      const operations = Array.from({ length: 30 }, (_, i) => ({
        type: 'put' as const,
        item: { PK: `USER#${i}`, SK: `FILE#${i}` },
      }));

      await batchWrite(operations);

      expect(mockSend).toHaveBeenCalledTimes(2);
      const firstBatch = mockSend.mock.calls[0][0].input.RequestItems['vaultstream-metadata'];
      const secondBatch = mockSend.mock.calls[1][0].input.RequestItems['vaultstream-metadata'];
      expect(firstBatch).toHaveLength(25);
      expect(secondBatch).toHaveLength(5);
    });

    it('should throw on invalid operation', async () => {
      await expect(
        batchWrite([{ type: 'put' }]),
      ).rejects.toThrow('Invalid batch operation');
    });
  });
});
