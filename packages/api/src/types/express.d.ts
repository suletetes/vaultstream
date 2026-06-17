/**
 * Express type augmentation for VaultStream.
 * Adds requestId, user, fileMetadata, and share to the Express Request interface.
 */

import { FileEntity, ShareEntity } from '@vaultstream/shared';

interface RequestUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  tier?: 'free' | 'pro' | 'enterprise';
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: RequestUser;
      fileMetadata?: FileEntity;
      share?: ShareEntity;
    }
  }
}

export {};
