# VaultStream Infrastructure (AWS CDK)

AWS CDK v2 TypeScript stacks defining all VaultStream infrastructure.

## Architecture

![System Architecture](../docs/vaultstream-architecture.png)
![Security Layers](../docs/vaultstream-security.png)

## Stacks

| Stack | Resources |
|-------|-----------|
| **NetworkStack** | VPC, subnets (public/private × 2 AZs), NAT Gateways, VPC Endpoints (S3, DynamoDB, KMS, SQS), security groups |
| **StorageStack** | S3 buckets (files, thumbnails, frontend, logs), lifecycle rules, versioning, SSE-KMS, CORS, BlockPublicAccess |
| **DatabaseStack** | DynamoDB (single-table, GSIs, PITR, TTL), RDS PostgreSQL (backups, read replica), ElastiCache Redis (TLS, AUTH) |
| **SecurityStack** | KMS CMK (annual rotation), Cognito User Pool + App Client, WAF WebACL (rate limit, SQLi, XSS, bot control, geo-block) |
| **ComputeStack** | Lambda functions (API, thumbnail, virus scan, lifecycle, post-signup), API Gateway REST + Cognito authorizer |
| **MessagingStack** | EventBridge (event bus + rules), SQS queues + DLQs, SNS notifications topic |
| **CdnStack** | CloudFront distributions (frontend, API, thumbnails), OAC, security headers |
| **MonitoringStack** | CloudWatch alarms, CloudTrail, log groups (30-day retention), operations dashboard |

## Commands

```bash
npx cdk synth       # Synthesize CloudFormation templates
npx cdk diff        # Preview changes
npx cdk deploy      # Deploy all stacks
npx cdk destroy     # Tear down (careful!)
```

## Environments

- **dev** · Single NAT, single-AZ RDS, no replicas
- **prod** · Dual NAT, Multi-AZ RDS, read replica, ElastiCache replica, provisioned Lambda concurrency
