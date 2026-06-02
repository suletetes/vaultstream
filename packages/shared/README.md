# @vaultstream/shared

Shared TypeScript types, Zod validation schemas, constants, and utilities used across all packages.

## Contents

| Directory | Purpose |
|-----------|---------|
| `src/types/` | Entity interfaces (File, Folder, Share, User, Version, Comment) |
| `src/schemas/` | Zod request/response validation schemas |
| `src/constants/` | MIME types, tier quotas, rate limits, regex patterns |
| `src/errors/` | AppError class, ErrorCode enum, error response format |
| `src/utils/` | ULID generator, filename sanitizer, pagination helpers |

## Usage

```typescript
import { uploadUrlSchema, AppError, generateUlid } from '@vaultstream/shared';

// Validate request
const result = uploadUrlSchema.safeParse(req.body);

// Generate sortable ID
const fileId = `file_${generateUlid()}`;

// Throw typed error
throw new AppError('QUOTA_EXCEEDED', 'Storage limit reached', 409);
```

## Property Tests

19 correctness properties validated with fast-check, covering filename validation, quota checks, authorization decisions, cache transparency, and more.
