# @vaultstream/frontend

React SPA for VaultStream. File management, sharing, search, and admin dashboard.

## Tech Stack

- React 18 + TypeScript
- Vite (build + HMR)
- Tailwind CSS
- TanStack Query (server state)
- React Router (client-side routing)
- Axios (API client with JWT interceptors)

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | File browser with upload dropzone |
| `/shared` | Shared | Files shared with current user |
| `/search` | Search | Search by name, tags, MIME type |
| `/trash` | Trash | Soft-deleted files with restore |
| `/login` | Login | Cognito PKCE authentication |
| `/callback` | Callback | OAuth code exchange |

## Auth

Cognito OAuth 2.0 with PKCE flow. Tokens stored in memory only (not localStorage). Automatic refresh before expiry.

## Running

```bash
npm run dev      # Vite dev server on http://localhost:3000
npm run build    # Production build
npm run preview  # Preview production build
```

## Deployment

Built static assets are synced to S3 and served via CloudFront with custom error pages for SPA routing.
