/**
 * Seed Script — Populate DynamoDB with test data for local development
 *
 * Usage: npx tsx scripts/seed-data.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  })
);

const TABLE_NAME = 'vaultstream-metadata';

async function seed() {
  console.log('Seeding DynamoDB with test data...');

  // Test user 1
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'USER#usr_test_alice',
      SK: 'PROFILE#usr_test_alice',
      entityType: 'USER_PROFILE',
      email: 'alice@example.com',
      displayName: 'Alice Johnson',
      storageUsedBytes: 1048576,
      storageQuotaBytes: 5368709120,
      tier: 'free',
      role: 'user',
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-05-01T12:00:00Z',
      GSI1PK: 'USERS',
      GSI1SK: '2026-01-15T10:00:00Z',
    },
  }));

  // Test user 2
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'USER#usr_test_bob',
      SK: 'PROFILE#usr_test_bob',
      entityType: 'USER_PROFILE',
      email: 'bob@example.com',
      displayName: 'Bob Smith',
      storageUsedBytes: 524288,
      storageQuotaBytes: 107374182400,
      tier: 'pro',
      role: 'user',
      createdAt: '2026-02-01T08:00:00Z',
      updatedAt: '2026-05-10T09:00:00Z',
      GSI1PK: 'USERS',
      GSI1SK: '2026-02-01T08:00:00Z',
    },
  }));

  // Admin user
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'USER#usr_test_admin',
      SK: 'PROFILE#usr_test_admin',
      entityType: 'USER_PROFILE',
      email: 'admin@vaultstream.dev',
      displayName: 'Admin User',
      storageUsedBytes: 0,
      storageQuotaBytes: 1099511627776,
      tier: 'enterprise',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      GSI1PK: 'USERS',
      GSI1SK: '2026-01-01T00:00:00Z',
    },
  }));

  // Sample files for Alice
  const files = [
    { id: 'file_test_001', name: 'quarterly-report.pdf', mime: 'application/pdf', size: 524288 },
    { id: 'file_test_002', name: 'team-photo.jpg', mime: 'image/jpeg', size: 2097152 },
    { id: 'file_test_003', name: 'budget-2026.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 131072 },
  ];

  for (const file of files) {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'USER#usr_test_alice',
        SK: `FILE#${file.id}`,
        entityType: 'FILE',
        fileId: file.id,
        filename: file.name,
        mimeType: file.mime,
        sizeBytes: file.size,
        s3Key: `users/usr_test_alice/files/${file.id}/1/${file.name}`,
        s3VersionId: 'v1',
        encryptedDataKey: 'dGVzdC1lbmNyeXB0ZWQta2V5',
        kmsKeyId: 'alias/vaultstream-master-key',
        thumbnailKey: file.mime.startsWith('image/') ? `users/usr_test_alice/files/${file.id}/thumb.webp` : null,
        folderId: 'ROOT',
        tags: ['test'],
        storageClass: 'STANDARD',
        virusScanStatus: 'clean',
        version: 1,
        isDeleted: false,
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
        lastAccessedAt: '2026-05-20T14:00:00Z',
        GSI1PK: 'USER#usr_test_alice',
        GSI1SK: '2026-05-20T14:00:00Z',
        GSI2PK: 'FOLDER#ROOT',
        GSI2SK: file.name,
      },
    }));
  }

  // Sample folder for Alice
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'USER#usr_test_alice',
      SK: 'FOLDER#folder_test_001',
      entityType: 'FOLDER',
      folderId: 'folder_test_001',
      folderName: 'Documents',
      parentFolderId: 'ROOT',
      fileCount: 0,
      totalSizeBytes: 0,
      createdAt: '2026-02-15T10:00:00Z',
      updatedAt: '2026-02-15T10:00:00Z',
      GSI2PK: 'FOLDER#ROOT',
      GSI2SK: 'Documents',
    },
  }));

  console.log('Seed data created successfully!');
  console.log('  - 3 users (alice, bob, admin)');
  console.log('  - 3 files for alice');
  console.log('  - 1 folder for alice');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
