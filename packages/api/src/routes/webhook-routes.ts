/**
 * Webhook Routes — Express Router for webhook endpoints.
 *
 * Routes:
 * - POST /api/webhooks → Register a new webhook
 * - GET /api/webhooks → List all webhooks
 * - DELETE /api/webhooks/:id → Delete a webhook
 * - GET /api/webhooks/:id/deliveries → Get delivery log
 *
 * Requirements: 25.1, 25.7
 */

import { Router } from 'express';
import { cognitoAuth } from '../middleware/auth';
import { registerWebhook, listWebhooks, deleteWebhook, getDeliveryLog } from '../controllers/webhook-controller';

const router = Router();

router.post('/api/webhooks', cognitoAuth(), registerWebhook);
router.get('/api/webhooks', cognitoAuth(), listWebhooks);
router.delete('/api/webhooks/:id', cognitoAuth(), deleteWebhook);
router.get('/api/webhooks/:id/deliveries', cognitoAuth(), getDeliveryLog);

export { router as webhookRoutes };
