import { describe, it, expect } from 'vitest';
import { sanitizeFilename, isValidFilename, containsPathTraversal } from './sanitize';

describe('Filename Sanitization', () => {
  describe('sanitizeFilename', () => {
    it('should pass through valid filenames unchanged', () => {
      expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
      expect(sanitizeFilename('my-file_v2 (1).txt')).toBe('my-file_v2 (1).txt');
    });

    it('should strip path traversal sequences (../)', () => {
      expect(sanitizeFilename('../etc/passwd')).toBe('etcpasswd');
      expect(sanitizeFilename('../../secret.txt')).toBe('secret.txt');
    });

    it('should strip path traversal sequences (..\\)', () => {
      expect(sanitizeFilename('..\\windows\\system32')).toBe('windowssystem32');
      expect(sanitizeFilename('..\\..\\secret.txt')).toBe('secret.txt');
    });

    it('should strip nested path traversal sequences', () => {
      expect(sanitizeFilename('....//test.txt')).toBe('test.txt');
      expect(sanitizeFilename('..../\\test.txt')).toBe('test.txt');
    });

    it('should remove unsafe characters', () => {
      expect(sanitizeFilename('file<name>.txt')).toBe('filename.txt');
      expect(sanitizeFilename('file|name?.txt')).toBe('filename.txt');
      expect(sanitizeFilename('file:name*.txt')).toBe('filename.txt');
    });

    it('should collapse multiple consecutive dots', () => {
      expect(sanitizeFilename('file...txt')).toBe('file.txt');
      expect(sanitizeFilename('..hidden')).toBe('.hidden');
    });

    it('should trim whitespace', () => {
      expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
    });

    it('should return "unnamed" for empty results', () => {
      expect(sanitizeFilename('')).toBe('unnamed');
      expect(sanitizeFilename('///')).toBe('unnamed');
      expect(sanitizeFilename('<>|')).toBe('unnamed');
    });

    it('should truncate to 255 characters', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });
  });

  describe('isValidFilename', () => {
    it('should accept valid filenames', () => {
      expect(isValidFilename('document.pdf')).toBe(true);
      expect(isValidFilename('my-file_v2 (1).txt')).toBe(true);
      expect(isValidFilename('A')).toBe(true);
      expect(isValidFilename('file123.test.backup')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidFilename('')).toBe(false);
    });

    it('should reject strings longer than 255 characters', () => {
      expect(isValidFilename('a'.repeat(256))).toBe(false);
    });

    it('should reject filenames with path separators', () => {
      expect(isValidFilename('path/file.txt')).toBe(false);
      expect(isValidFilename('path\\file.txt')).toBe(false);
    });

    it('should reject filenames with special characters', () => {
      expect(isValidFilename('file<name>.txt')).toBe(false);
      expect(isValidFilename('file|name.txt')).toBe(false);
      expect(isValidFilename('file:name.txt')).toBe(false);
      expect(isValidFilename('file*name.txt')).toBe(false);
      expect(isValidFilename('file?name.txt')).toBe(false);
    });
  });

  describe('containsPathTraversal', () => {
    it('should detect ../ sequences', () => {
      expect(containsPathTraversal('../etc/passwd')).toBe(true);
      expect(containsPathTraversal('foo/../bar')).toBe(true);
    });

    it('should detect ..\\ sequences', () => {
      expect(containsPathTraversal('..\\windows')).toBe(true);
      expect(containsPathTraversal('foo\\..\\bar')).toBe(true);
    });

    it('should return false for safe strings', () => {
      expect(containsPathTraversal('document.pdf')).toBe(false);
      expect(containsPathTraversal('my..file.txt')).toBe(false);
      expect(containsPathTraversal('..hidden')).toBe(false);
    });
  });
});
