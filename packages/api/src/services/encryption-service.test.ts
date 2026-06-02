/**
 * EncryptionService Unit Tests
 *
 * Mocks the KMS client to test envelope encryption key generation,
 * throttling handling, and general error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KMSClient, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { EncryptionService } from './encryption-service.js';
import { AppError, ErrorCode } from '@vaultstream/shared';

// Mock the KMS client send method
const mockSend = vi.fn();
const mockKmsClient = { send: mockSend } as unknown as KMSClient;

const TEST_KEY_ID = 'arn:aws:kms:us-east-1:123456789012:key/test-key-id';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EncryptionService(mockKmsClient, TEST_KEY_ID);
  });

  describe('generateDataKey', () => {
    it('should return plaintextDek as Buffer and encryptedDek as base64 string', async () => {
      const fakePlaintext = new Uint8Array(32).fill(0xab);
      const fakeCiphertext = new Uint8Array(64).fill(0xcd);

      mockSend.mockResolvedValueOnce({
        Plaintext: fakePlaintext,
        CiphertextBlob: fakeCiphertext,
      });

      const result = await service.generateDataKey();

      expect(result.plaintextDek).toBeInstanceOf(Buffer);
      expect(result.plaintextDek.length).toBe(32);
      expect(result.plaintextDek[0]).toBe(0xab);

      expect(typeof result.encryptedDek).toBe('string');
      // Verify it's valid base64
      const decoded = Buffer.from(result.encryptedDek, 'base64');
      expect(decoded.length).toBe(64);
      expect(decoded[0]).toBe(0xcd);
    });

    it('should call KMS GenerateDataKey with correct parameters', async () => {
      const fakePlaintext = new Uint8Array(32).fill(0x01);
      const fakeCiphertext = new Uint8Array(64).fill(0x02);

      mockSend.mockResolvedValueOnce({
        Plaintext: fakePlaintext,
        CiphertextBlob: fakeCiphertext,
      });

      await service.generateDataKey();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(GenerateDataKeyCommand);
      expect(command.input).toEqual({
        KeyId: TEST_KEY_ID,
        KeySpec: 'AES_256',
      });
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 5 on ThrottlingException', async () => {
      const throttleError = new Error('Rate exceeded');
      (throttleError as unknown as { name: string }).name = 'ThrottlingException';

      mockSend.mockRejectedValueOnce(throttleError);

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.statusCode).toBe(503);
        expect(appError.retryAfter).toBe(5);
        expect(appError.message).toContain('throttled');
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 5 on ThrottlingException via __type', async () => {
      const throttleError = new Error('Throttled');
      (throttleError as unknown as { __type: string }).__type = 'ThrottlingException';

      mockSend.mockRejectedValueOnce(throttleError);

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.retryAfter).toBe(5);
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 5 on ThrottlingException via code', async () => {
      const throttleError = new Error('Throttled');
      (throttleError as unknown as { code: string }).code = 'ThrottlingException';

      mockSend.mockRejectedValueOnce(throttleError);

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.retryAfter).toBe(5);
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 30 on other KMS errors', async () => {
      const kmsError = new Error('Internal failure');
      (kmsError as unknown as { name: string }).name = 'KMSInternalException';

      mockSend.mockRejectedValueOnce(kmsError);

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.statusCode).toBe(503);
        expect(appError.retryAfter).toBe(30);
        expect(appError.message).toContain('temporarily unavailable');
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 30 on network errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network timeout'));

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.retryAfter).toBe(30);
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 30 when KMS returns no Plaintext', async () => {
      mockSend.mockResolvedValueOnce({
        Plaintext: undefined,
        CiphertextBlob: new Uint8Array(64).fill(0x01),
      });

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.retryAfter).toBe(30);
        expect(appError.message).toContain('incomplete response');
      }
    });

    it('should throw SERVICE_UNAVAILABLE with retryAfter 30 when KMS returns no CiphertextBlob', async () => {
      mockSend.mockResolvedValueOnce({
        Plaintext: new Uint8Array(32).fill(0x01),
        CiphertextBlob: undefined,
      });

      try {
        await service.generateDataKey();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(appError.retryAfter).toBe(30);
        expect(appError.message).toContain('incomplete response');
      }
    });

    it('should produce different encrypted DEKs for different KMS responses', async () => {
      const plaintext1 = new Uint8Array(32).fill(0x11);
      const ciphertext1 = new Uint8Array(64).fill(0x22);
      const plaintext2 = new Uint8Array(32).fill(0x33);
      const ciphertext2 = new Uint8Array(64).fill(0x44);

      mockSend
        .mockResolvedValueOnce({ Plaintext: plaintext1, CiphertextBlob: ciphertext1 })
        .mockResolvedValueOnce({ Plaintext: plaintext2, CiphertextBlob: ciphertext2 });

      const result1 = await service.generateDataKey();
      const result2 = await service.generateDataKey();

      expect(result1.encryptedDek).not.toBe(result2.encryptedDek);
      expect(result1.plaintextDek.equals(result2.plaintextDek)).toBe(false);
    });
  });
});
