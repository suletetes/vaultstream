#!/bin/bash
# Pre-deployment backup script
# Creates RDS snapshot and DynamoDB on-demand backup before deploying
#
# Usage: ./scripts/pre-deploy-backup.sh
# Requirements: 35.5

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RDS_INSTANCE="vaultstream-audit"
DYNAMODB_TABLE="vaultstream-metadata"

echo "=== VaultStream Pre-Deploy Backup ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# 1. RDS Snapshot
echo "Creating RDS snapshot..."
aws rds create-db-snapshot \
  --db-instance-identifier "$RDS_INSTANCE" \
  --db-snapshot-identifier "pre-deploy-${TIMESTAMP}" \
  --tags Key=Purpose,Value=pre-deploy Key=Timestamp,Value="$TIMESTAMP"

echo "  Snapshot: pre-deploy-${TIMESTAMP}"

# 2. DynamoDB On-Demand Backup
echo "Creating DynamoDB backup..."
BACKUP_ARN=$(aws dynamodb create-backup \
  --table-name "$DYNAMODB_TABLE" \
  --backup-name "pre-deploy-${TIMESTAMP}" \
  --query 'BackupDetails.BackupArn' \
  --output text)

echo "  Backup ARN: $BACKUP_ARN"

# 3. Wait for RDS snapshot to be available (optional, can be slow)
echo ""
echo "Waiting for RDS snapshot to become available..."
aws rds wait db-snapshot-available \
  --db-snapshot-identifier "pre-deploy-${TIMESTAMP}" \
  2>/dev/null || echo "  (Snapshot still creating — proceeding with deploy)"

echo ""
echo "=== Backup Complete ==="
echo "RDS Snapshot: pre-deploy-${TIMESTAMP}"
echo "DynamoDB Backup: pre-deploy-${TIMESTAMP}"
echo ""
echo "To restore RDS:"
echo "  aws rds restore-db-instance-from-db-snapshot --db-instance-identifier vaultstream-audit-restored --db-snapshot-identifier pre-deploy-${TIMESTAMP}"
echo ""
echo "To restore DynamoDB:"
echo "  aws dynamodb restore-table-from-backup --target-table-name vaultstream-metadata-restored --backup-arn $BACKUP_ARN"
