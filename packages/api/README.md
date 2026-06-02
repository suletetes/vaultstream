# @vaultstream/api

Express API server deployed on AWS Lambda via `@vendia/serverless-express`.

## Architecture

![System Architecture](../../docs/vaultstream-architecture.png)

## Features

- **File Management** · Upload (presigned URLs), download, versioning, soft-delete/restore
- **Folder Management** · Nested folders, move files, counters
- **Sharing** · Granular permissions (view/download/edit), expiration, CloudFront signed URLs
- **Search** · Filename prefix, tag filter (AND), MIME type filter
- **Caching** · Redis cache-aside with TTL invalidation on writes
- **Audit** · Fire-and-forget PostgreSQL logging, CSV export
- **Rate Limiting** · Per-user Redis counters, tier-based limits
- **Webhooks** · HMAC-SHA256 signed, retry with backoff (enterprise tier)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/files/upload-url | Generate presigned PUT URL |
| POST | /api/files/upload-complete | Confirm upload |
| GET | /api/files | List files |
| GET | /api/files/:id/download-url | Presigned GET URL |
| DELETE | /api/files/:id | Soft-delete |
| POST | /api/files/:id/share | Share file |
| GET | /api/shared | Shared-with-me |
| GET | /api/recent | Recently accessed |
| GET | /api/search | Search files |
| GET | /api/audit | Query audit log |
| POST | /api/bulk/delete | Bulk soft-delete |

## Running Locally

```bash
npm run dev    # tsx watch mode
```

## Testing

```bash
npx vitest run              # all tests
npx vitest run --coverage   # with coverage
```

487 tests covering services, middleware, validators, and 19 property-based correctness tests.
