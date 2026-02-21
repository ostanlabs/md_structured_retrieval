/**
 * doc-uri Tests
 *
 * TDD: These tests define the expected behavior of doc-uri utilities.
 */

import { describe, it, expect } from 'vitest';
import { toDocUri, toAbsolutePath, isValidDocUri } from '../doc-uri.js';

describe('toDocUri', () => {
  it('should convert absolute path to vault-relative POSIX path', () => {
    const result = toDocUri('/vault/notes/test.md', '/vault');
    expect(result).toBe('notes/test.md');
  });

  it('should handle file at vault root', () => {
    const result = toDocUri('/vault/test.md', '/vault');
    expect(result).toBe('test.md');
  });

  it('should handle deeply nested paths', () => {
    const result = toDocUri('/vault/a/b/c/d/test.md', '/vault');
    expect(result).toBe('a/b/c/d/test.md');
  });

  it('should normalize backslashes to forward slashes', () => {
    // Simulate Windows-style path
    const result = toDocUri('/vault/notes\\subfolder\\test.md', '/vault');
    expect(result).toBe('notes/subfolder/test.md');
  });

  it('should handle spaces in path', () => {
    const result = toDocUri('/vault/my notes/test file.md', '/vault');
    expect(result).toBe('my notes/test file.md');
  });

  it('should handle special characters in path', () => {
    const result = toDocUri('/vault/notes/test-file_123.md', '/vault');
    expect(result).toBe('notes/test-file_123.md');
  });

  it('should handle unicode characters in path', () => {
    const result = toDocUri('/vault/日本語/ファイル.md', '/vault');
    expect(result).toBe('日本語/ファイル.md');
  });

  it('should not add leading slash', () => {
    const result = toDocUri('/vault/test.md', '/vault');
    expect(result).not.toMatch(/^\//);
  });

  it('should handle vault root with trailing slash', () => {
    const result = toDocUri('/vault/notes/test.md', '/vault/');
    expect(result).toBe('notes/test.md');
  });

  it('should throw for path outside vault', () => {
    expect(() => toDocUri('/other/test.md', '/vault')).toThrow();
  });
});

describe('toAbsolutePath', () => {
  it('should convert doc_uri to absolute path', () => {
    const result = toAbsolutePath('notes/test.md', '/vault');
    expect(result).toBe('/vault/notes/test.md');
  });

  it('should handle file at vault root', () => {
    const result = toAbsolutePath('test.md', '/vault');
    expect(result).toBe('/vault/test.md');
  });

  it('should handle deeply nested paths', () => {
    const result = toAbsolutePath('a/b/c/d/test.md', '/vault');
    expect(result).toBe('/vault/a/b/c/d/test.md');
  });

  it('should handle vault root with trailing slash', () => {
    const result = toAbsolutePath('notes/test.md', '/vault/');
    expect(result).toBe('/vault/notes/test.md');
  });

  it('should handle spaces in path', () => {
    const result = toAbsolutePath('my notes/test file.md', '/vault');
    expect(result).toBe('/vault/my notes/test file.md');
  });
});

describe('isValidDocUri', () => {
  it('should return true for valid doc_uri', () => {
    expect(isValidDocUri('notes/test.md')).toBe(true);
    expect(isValidDocUri('test.md')).toBe(true);
    expect(isValidDocUri('a/b/c.md')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(isValidDocUri('')).toBe(false);
  });

  it('should return false for absolute path', () => {
    expect(isValidDocUri('/notes/test.md')).toBe(false);
  });

  it('should return false for non-.md extension', () => {
    expect(isValidDocUri('notes/test.txt')).toBe(false);
    expect(isValidDocUri('notes/test')).toBe(false);
  });

  it('should return false for path with backslashes', () => {
    expect(isValidDocUri('notes\\test.md')).toBe(false);
  });

  it('should return true for unicode paths', () => {
    expect(isValidDocUri('日本語/ファイル.md')).toBe(true);
  });

  it('should return true for paths with spaces', () => {
    expect(isValidDocUri('my notes/test file.md')).toBe(true);
  });
});

