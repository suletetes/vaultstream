# VaultStream Architecture Diagrams

Auto-generated architecture diagrams using the Python [`diagrams`](https://github.com/mingrammer/diagrams) library.

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

## Regenerating

```bash
# Prerequisites
pip install diagrams
# Windows: winget install Graphviz.Graphviz (ensure C:\Program Files\Graphviz\bin is on PATH)

# Generate
python docs/generate_architecture.py
```

Outputs PNG (with embedded icons) and SVG (with base64-inlined icons) for each diagram.

## SVG Notes

SVG files have icons embedded as base64 data URIs. They're fully self-contained and portable. No external file references.
