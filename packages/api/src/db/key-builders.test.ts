import { describe, it, expect } from 'vitest';
import {
  userPK,
  userProfileSK,
  fileSK,
  folderSK,
  sharePK,
  shareSK,
  versionSK,
  commentSK,
  gsi1Keys,
  gsi2Keys,
  gsi3Keys,
} from './key-builders';

describe('key-builders', () => {
  describe('userPK', () => {
    it('should construct USER# prefixed key', () => {
      expect(userPK('abc123')).toBe('USER#abc123');
    });
  });

  describe('userProfileSK', () => {
    it('should construct PROFILE# prefixed key', () => {
      expect(userProfileSK('abc123')).toBe('PROFILE#abc123');
    });
  });

  describe('fileSK', () => {
    it('should construct FILE# prefixed key', () => {
      expect(fileSK('file-001')).toBe('FILE#file-001');
    });
  });

  describe('folderSK', () => {
    it('should construct FOLDER# prefixed key', () => {
      expect(folderSK('folder-001')).toBe('FOLDER#folder-001');
    });
  });

  describe('sharePK', () => {
    it('should construct FILE# prefixed key for share partition', () => {
      expect(sharePK('file-001')).toBe('FILE#file-001');
    });
  });

  describe('shareSK', () => {
    it('should construct SHARE# prefixed key', () => {
      expect(shareSK('user-target')).toBe('SHARE#user-target');
    });
  });

  describe('versionSK', () => {
    it('should construct VERSION# prefixed key with zero-padded number', () => {
      expect(versionSK(1)).toBe('VERSION#00001');
      expect(versionSK(42)).toBe('VERSION#00042');
      expect(versionSK(99999)).toBe('VERSION#99999');
    });
  });

  describe('commentSK', () => {
    it('should construct COMMENT# prefixed key', () => {
      expect(commentSK('cmt-001')).toBe('COMMENT#cmt-001');
    });
  });

  describe('gsi1Keys', () => {
    it('should return GSI1PK as USER# and GSI1SK as lastAccessedAt', () => {
      const result = gsi1Keys('user-1', '2024-01-15T10:30:00.000Z');
      expect(result).toEqual({
        GSI1PK: 'USER#user-1',
        GSI1SK: '2024-01-15T10:30:00.000Z',
      });
    });
  });

  describe('gsi2Keys', () => {
    it('should return GSI2PK as FOLDER# and GSI2SK as name', () => {
      const result = gsi2Keys('folder-1', 'my-document.pdf');
      expect(result).toEqual({
        GSI2PK: 'FOLDER#folder-1',
        GSI2SK: 'my-document.pdf',
      });
    });
  });

  describe('gsi3Keys', () => {
    it('should return GSI3PK as USER# and GSI3SK as sharedAt', () => {
      const result = gsi3Keys('target-user', '2024-02-20T14:00:00.000Z');
      expect(result).toEqual({
        GSI3PK: 'USER#target-user',
        GSI3SK: '2024-02-20T14:00:00.000Z',
      });
    });
  });
});
