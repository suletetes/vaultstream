#!/bin/bash
# Initialize LocalStack resources for local development

echo "Creating S3 buckets..."
awslocal s3 mb s3://vaultstream-files-local
awslocal s3 mb s3://vaultstream-thumbnails-local
awslocal s3 mb s3://vaultstream-frontend-local

echo "Enabling S3 versioning..."
awslocal s3api put-bucket-versioning --bucket vaultstream-files-local --versioning-configuration Status=Enabled

echo "Creating DynamoDB table..."
awslocal dynamodb create-table \
  --table-name vaultstream-metadata \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
    AttributeName=GSI3PK,AttributeType=S \
    AttributeName=GSI3SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {"IndexName":"GSI1","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},
      {"IndexName":"GSI2","KeySchema":[{"AttributeName":"GSI2PK","KeyType":"HASH"},{"AttributeName":"GSI2SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},
      {"IndexName":"GSI3","KeySchema":[{"AttributeName":"GSI3PK","KeyType":"HASH"},{"AttributeName":"GSI3SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}
    ]' \
  --billing-mode PAY_PER_REQUEST

echo "Enabling DynamoDB TTL..."
awslocal dynamodb update-time-to-live \
  --table-name vaultstream-metadata \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt

echo "Creating KMS key..."
KEY_ID=$(awslocal kms create-key --description "VaultStream master key" --query 'KeyMetadata.KeyId' --output text)
awslocal kms create-alias --alias-name alias/vaultstream-master-key --target-key-id "$KEY_ID"

echo "Creating SQS queues..."
awslocal sqs create-queue --queue-name vaultstream-thumbnail-dlq
awslocal sqs create-queue --queue-name vaultstream-virus-scan-dlq

THUMB_DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url http://localhost:4566/000000000000/vaultstream-thumbnail-dlq --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
VIRUS_DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url http://localhost:4566/000000000000/vaultstream-virus-scan-dlq --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs create-queue --queue-name vaultstream-thumbnail-queue \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$THUMB_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

awslocal sqs create-queue --queue-name vaultstream-virus-scan-queue \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$VIRUS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "Creating SNS topic..."
awslocal sns create-topic --name vaultstream-notifications

echo "Creating EventBridge event bus..."
awslocal events create-event-bus --name vaultstream-events

echo "Enabling S3 EventBridge notifications..."
awslocal s3api put-bucket-notification-configuration --bucket vaultstream-files-local \
  --notification-configuration '{"EventBridgeConfiguration":{}}'

echo "LocalStack initialization complete!"
