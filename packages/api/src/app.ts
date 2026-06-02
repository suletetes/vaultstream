/**
 * VaultStream Express Application
 *
 * Configures the Express app with the middleware pipeline:
 * 1. Correlation ID (X-Request-Id generation/propagation)
 * 2. Pino structured JSON logging
 * 3. Body parser (JSON, 1MB limit)
 * 4. CORS (restricted origins)
 * 5. Route handlers (added later)
 * 6. Global error handler
 */

import express from 'express';
import cors from 'cors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { correlationId } from './middleware/correlation-id';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import { auditLogger } from './middleware/audit-logger';
import { fileRoutes } from './routes/file-routes';
import { folderRoutes } from './routes/folder-routes';
import { shareRoutes } from './routes/share-routes';
import { viewRoutes } from './routes/view-routes';
import { activityRoutes } from './routes/activity-routes';
import { auditRoutes } from './routes/audit-routes';
import { searchRoutes } from './routes/search-routes';
import { bulkRoutes } from './routes/bulk-routes';
import { webhookRoutes } from './routes/webhook-routes';
import { adminRoutes } from './routes/admin-routes';
import { commentRoutes } from './routes/comment-routes';

// ─── Logger ─────────────────────────────────────────────────────────────────

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: 'vaultstream-api',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ─── Express App ────────────────────────────────────────────────────────────

const app = express();

// 1. Correlation ID — generate/propagate X-Request-Id
app.use(correlationId());

// 2. Pino HTTP logger — structured JSON logging with requestId
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).requestId || 'unknown',
    customProps: (req) => ({
      requestId: (req as express.Request).requestId,
    }),
  })
);

// 3. Body parser — JSON with 1MB limit
app.use(express.json({ limit: '1mb' }));

// 4. CORS — restricted to app domain and local development
app.use(
  cors({
    origin: ['https://app.vaultstream.dev', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  })
);

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Rate Limiter ───────────────────────────────────────────────────────────

app.use(rateLimiter());

// ─── Audit Logger ───────────────────────────────────────────────────────────

app.use(auditLogger());

// ─── Routes ─────────────────────────────────────────────────────────────────

app.use(fileRoutes);
app.use(folderRoutes);
app.use(shareRoutes);
app.use(viewRoutes);
app.use(activityRoutes);
app.use(auditRoutes);
app.use(searchRoutes);
app.use(bulkRoutes);
app.use(webhookRoutes);
app.use(adminRoutes);
app.use(commentRoutes);

// ─── Error Handler (must be last) ──────────────────────────────────────────

app.use(errorHandler());

export { app };
