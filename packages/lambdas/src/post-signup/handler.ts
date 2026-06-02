/**
 * Post-Signup Lambda Handler (Cognito PostConfirmation Trigger)
 *
 * Creates a USER_PROFILE entity in DynamoDB when a new user confirms their email.
 * Sets up the default free-tier quota (5GB) and initial profile metadata.
 *
 * Validates: Requirement 12.5
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'vaultstream-metadata';

const FREE_TIER_QUOTA_BYTES = 5_368_709_120; // 5GB

const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

if (process.env.AWS_ENDPOINT_URL) {
  clientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const ddbClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

/**
 * Extracts a display name from the Cognito event attributes.
 * Falls back to the email prefix if no name attribute is provided.
 */
function getDisplayName(userAttributes: Record<string, string>): string {
  if (userAttributes.name && userAttributes.name.trim().length > 0) {
    return userAttributes.name.trim();
  }

  const email = userAttributes.email ?? '';
  const prefix = email.split('@')[0] ?? 'user';
  return prefix;
}

/**
 * Cognito PostConfirmation trigger handler.
 *
 * Creates the user profile in DynamoDB with free-tier defaults.
 * Always returns the event object to avoid blocking the signup flow.
 */
export async function handler(
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  const userId = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;
  const displayName = getDisplayName(event.request.userAttributes);
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: `PROFILE#${userId}`,
          entityType: 'USER_PROFILE',
          email,
          displayName,
          storageUsedBytes: 0,
          storageQuotaBytes: FREE_TIER_QUOTA_BYTES,
          tier: 'free',
          role: 'user',
          createdAt: now,
          updatedAt: now,
          GSI1PK: 'USERS',
          GSI1SK: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    console.log('User profile created', { userId, email, displayName });
  } catch (error: unknown) {
    // Log the error but do NOT throw — returning the event is required
    // to avoid blocking the Cognito signup flow.
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to create user profile', { userId, email, error: message });
  }

  return event;
}
