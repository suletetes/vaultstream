-- VaultStream Audit Database Schema
-- Runs on PostgreSQL container startup

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    user_id VARCHAR(128),
    file_id VARCHAR(128),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(128),
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(128),
    duration_ms INTEGER,
    status_code INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partition for current month
DO $$
DECLARE
    start_date TEXT;
    end_date TEXT;
    partition_name TEXT;
BEGIN
    start_date := to_char(date_trunc('month', NOW()), 'YYYY-MM-DD');
    end_date := to_char(date_trunc('month', NOW()) + INTERVAL '1 month', 'YYYY-MM-DD');
    partition_name := 'audit_events_' || to_char(NOW(), 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END $$;

-- Create next month's partition
DO $$
DECLARE
    start_date TEXT;
    end_date TEXT;
    partition_name TEXT;
BEGIN
    start_date := to_char(date_trunc('month', NOW()) + INTERVAL '1 month', 'YYYY-MM-DD');
    end_date := to_char(date_trunc('month', NOW()) + INTERVAL '2 months', 'YYYY-MM-DD');
    partition_name := 'audit_events_' || to_char(NOW() + INTERVAL '1 month', 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_file_id ON audit_events (file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_severity ON audit_events (severity, created_at DESC);

-- Compliance: prevent deletion
REVOKE DELETE ON audit_events FROM PUBLIC;
