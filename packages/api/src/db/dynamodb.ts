/**
 * DynamoDB Client Configuration
 *
 * Configures the DynamoDBDocumentClient with marshalling options.
 * Supports AWS_ENDPOINT_URL env var for LocalStack in development.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'vaultstream-metadata';

const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

// Support LocalStack endpoint for local development
if (process.env.AWS_ENDPOINT_URL) {
  clientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const ddbClient = new DynamoDBClient(clientConfig);

const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

export { ddbClient, docClient, TABLE_NAME };
