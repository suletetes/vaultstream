/**
 * Express type augmentation for VaultStream.
 * Adds requestId, user, file, and share to the Express Request interface.
 */

import { FileEntity, ShareEntity } from '@vaultstream/shared';

interface RequestUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  tier: 'free' | 'pro' | 'enterprise';
}

declare namespace Express {
  interface Request {
    requestId: string;
    user?: RequestUser;
    file?: FileEntity;
    share?: ShareEntity;
  }
}
