/**
 * Base Repository
 *
 * Provides typed DynamoDB operations for the single-table design.
 * All methods operate against the configured table name.
 */

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from './dynamodb';

export interface QueryParams {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
  filterExpression?: string;
  scanIndexForward?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface QueryResult<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface BatchWriteOperation {
  type: 'put' | 'delete';
  item?: Record<string, unknown>;
  key?: { PK: string; SK: string };
}

/**
 * Get a single item by primary key.
 */
export async function getItem<T>(pk: string, sk: string): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
    }),
  );

  return (result.Item as T) ?? null;
}

/**
 * Put (create or overwrite) an item.
 */
export async function putItem<T extends object>(item: T): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    }),
  );
}

/**
 * Query items using key conditions and optional filters.
 */
export async function queryItems<T>(params: QueryParams): Promise<QueryResult<T>> {
  const input: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: params.keyConditionExpression,
    ExpressionAttributeValues: params.expressionAttributeValues,
  };

  if (params.indexName) {
    input.IndexName = params.indexName;
  }
  if (params.expressionAttributeNames) {
    input.ExpressionAttributeNames = params.expressionAttributeNames;
  }
  if (params.filterExpression) {
    input.FilterExpression = params.filterExpression;
  }
  if (params.scanIndexForward !== undefined) {
    input.ScanIndexForward = params.scanIndexForward;
  }
  if (params.limit !== undefined) {
    input.Limit = params.limit;
  }
  if (params.exclusiveStartKey) {
    input.ExclusiveStartKey = params.exclusiveStartKey;
  }

  const result = await docClient.send(new QueryCommand(input));

  return {
    items: (result.Items as T[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

/**
 * Update specific attributes on an item.
 */
export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) return;

  const expressionParts: string[] = [];
  const expressionAttributeValues: Record<string, unknown> = {};
  const expressionAttributeNames: Record<string, string> = {};

  for (const key of updateKeys) {
    const attrName = `#${key}`;
    const attrValue = `:${key}`;
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = updates[key];
    expressionParts.push(`${attrName} = ${attrValue}`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

/**
 * Delete a single item by primary key.
 */
export async function deleteItem(pk: string, sk: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
    }),
  );
}

/**
 * Batch write (put/delete) up to 25 items at a time.
 * Automatically chunks operations into batches of 25.
 */
export async function batchWrite(operations: BatchWriteOperation[]): Promise<void> {
  const BATCH_SIZE = 25;

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = operations.slice(i, i + BATCH_SIZE);

    const requestItems = batch.map((op) => {
      if (op.type === 'put' && op.item) {
        return { PutRequest: { Item: op.item } };
      }
      if (op.type === 'delete' && op.key) {
        return { DeleteRequest: { Key: op.key } };
      }
      throw new Error(`Invalid batch operation: type=${op.type}`);
    });

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: requestItems,
        },
      }),
    );
  }
}
