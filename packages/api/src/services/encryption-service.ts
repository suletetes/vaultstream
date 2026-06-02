/**
 * EncryptionService — KMS Envelope Encryption
 *
 * Generates per-file Data Encryption Keys (DEKs) using AWS KMS GenerateDataKey.
 * Each file gets a unique 256-bit DEK derived from the master CMK.
 * The plaintext DEK is used only for presigned URL generation, then discarded.
 * S3 SSE-KMS handles the actual file encryption at rest.
 *
 * Handles KMS throttling (ThrottlingException) with retryAfter: 5s
 * and other KMS errors with retryAfter: 30s.
 */

import {
  KMSClient,
  GenerateDataKeyCommand,
  type GenerateDataKeyCommandOutput,
} from '@aws-sdk/client-kms';
import { serviceUnavailableError } from '@vaultstream/shared';

export interface DataKeyResult {
  /** Plaintext DEK — discard after presigned URL generation */
  plaintextDek: Buffer;
  /** Encrypted DEK (base64) — stored in DynamoDB alongside file metadata */
  encryptedDek: string;
}

const KMS_KEY_ID = process.env.KMS_KEY_ID ?? '';

const kmsClientConfig: ConstructorParameters<typeof KMSClient>[0] = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

// Support LocalStack endpoint for local development
if (process.env.AWS_ENDPOINT_URL) {
  kmsClientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const kmsClient = new KMSClient(kmsClientConfig);

/**
 * Determines if a KMS error is a throttling exception.
 */
function isThrottlingError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { name?: string; __type?: string; code?: string };
    return (
      err.name === 'ThrottlingException' ||
      err.__type === 'ThrottlingException' ||
      err.code === 'ThrottlingException'
    );
  }
  return false;
}

export class EncryptionService {
  private readonly kms: KMSClient;
  private readonly keyId: string;

  constructor(client?: KMSClient, keyId?: string) {
    this.kms = client ?? kmsClient;
    this.keyId = keyId ?? KMS_KEY_ID;
  }

  /**
   * Generate a unique Data Encryption Key for a file.
   *
   * Calls KMS GenerateDataKey with AES_256 key spec.
   * Returns the plaintext DEK (for presigned URL generation) and
   * the encrypted DEK (base64, for storage in DynamoDB).
   *
   * @throws AppError with SERVICE_UNAVAILABLE (503) on KMS throttling (retryAfter: 5)
   * @throws AppError with SERVICE_UNAVAILABLE (503) on other KMS errors (retryAfter: 30)
   */
  async generateDataKey(): Promise<DataKeyResult> {
    try {
      const command = new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: 'AES_256',
      });

      const response: GenerateDataKeyCommandOutput = await this.kms.send(command);

      if (!response.Plaintext || !response.CiphertextBlob) {
        throw serviceUnavailableError(
          30,
          'KMS returned incomplete response',
        );
      }

      const plaintextDek = Buffer.from(response.Plaintext);
      const encryptedDek = Buffer.from(response.CiphertextBlob).toString('base64');

      return { plaintextDek, encryptedDek };
    } catch (error: unknown) {
      // Re-throw AppErrors (already handled above)
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'SERVICE_UNAVAILABLE') {
        throw error;
      }

      if (isThrottlingError(error)) {
        throw serviceUnavailableError(
          5,
          'KMS service is throttled, please retry',
        );
      }

      throw serviceUnavailableError(
        30,
        'KMS service is temporarily unavailable',
      );
    }
  }
}

// Default singleton instance
export const encryptionService = new EncryptionService();
