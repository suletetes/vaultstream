/**
 * WebhookController — Express route handlers for webhook endpoints.
 *
 * Handles:
 * - register: Register a new webhook endpoint
 * - list: List all webhooks for the user
 * - delete: Delete a webhook
 * - deliveryLog: Get delivery history for a webhook
 *
 * Requirements: 25.1, 25.7
 */

import { Request, Response, NextFunction } from 'express';

import { webhookService } from '../services/webhook-service';

/**
 * POST /api/webhooks
 * Body: { url, secret, events }
 */
export async function registerWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const tier = req.user!.tier || 'free';
    const { url, secret, events } = req.body;

    const webhook = await webhookService.register({
      userId,
      tier,
      url,
      secret,
      events,
    });

    res.status(201).json(webhook);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/webhooks
 */
export async function listWebhooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const webhooks = await webhookService.listWebhooks(userId);

    // Mask secrets in response
    const masked = webhooks.map((w) => ({
      ...w,
      secret: `${w.secret.slice(0, 4)}${'*'.repeat(Math.max(0, w.secret.length - 4))}`,
    }));

    res.status(200).json({ items: masked });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/webhooks/:id
 */
export async function deleteWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const webhookId = req.params.id;

    await webhookService.deleteWebhook(userId, webhookId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/webhooks/:id/deliveries
 * Placeholder — delivery log would be stored separately in production.
 */
export async function getDeliveryLog(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // In a full implementation, this would query a delivery log table
    res.status(200).json({ items: [], message: 'Delivery log not yet implemented' });
  } catch (error) {
    next(error);
  }
}
