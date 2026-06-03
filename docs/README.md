# VaultStream Architecture Diagrams

## Diagrams

### System Architecture
Main request flow: Users → CloudFront → WAF → API Gateway → Lambda → DynamoDB/Redis/RDS/S3/KMS

![System Architecture](vaultstream-architecture.png)

### Event Processing Pipeline
Event-driven processing: S3 upload → EventBridge → SQS → Thumbnail/Virus Scan Lambdas

![Event Processing](vaultstream-events.png)

### Security Architecture
5-layer defense: Edge (WAF/TLS) → Auth (Cognito/JWT) → Network (VPC) → Encryption (KMS) → Audit (RDS/CloudTrail)

![Security Architecture](vaultstream-security.png)

