# @vaultstream/lambdas

Event-driven Lambda functions for background processing.

## Architecture

![Event Processing](../../docs/vaultstream-events.png)

## Functions

| Function | Trigger | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| **Thumbnail Generator** | SQS (thumbnail queue) | 1024MB | 60s | Generate WebP thumbnails (200×200 + 800×600) using Sharp |
| **Virus Scanner** | SQS (virus scan queue) | 2048MB | 300s | Scan files with ClamAV, quarantine infected |
| **Lifecycle Processor** | EventBridge (S3 transitions) | 256MB | 30s | Update DynamoDB on storage class changes, purge expired deletes |
| **Post-Signup** | Cognito PostConfirmation | 128MB | 5s | Create user profile in DynamoDB |

## Error Handling

- All functions use SQS batch item failure reporting
- Failed messages retry 3 times before moving to Dead Letter Queue
- CloudWatch alarm fires when DLQ depth > 0 for 15 minutes

## Event Flow

```
S3 Upload → EventBridge → SQS Thumbnail Queue → Thumbnail Lambda → S3 Thumbnails + DynamoDB
                        → SQS Virus Scan Queue → Virus Scan Lambda → DynamoDB (status update)
```
