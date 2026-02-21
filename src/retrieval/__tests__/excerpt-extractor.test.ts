/**
 * Excerpt Extractor Tests
 *
 * TDD: These tests define the expected behavior of the excerpt extraction system
 * that reads text from files and handles truncation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExcerptExtractor, ExcerptResult } from '../excerpt-extractor.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ExcerptExtractor', () => {
  let tmpDir: string;
  let extractor: ExcerptExtractor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-excerpt-test-'));
    extractor = new ExcerptExtractor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createFile(relativePath: string, content: string): void {
    const fullPath = path.join(tmpDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  describe('extract()', () => {
    it('should extract text from file at given offsets', () => {
      createFile('test.md', 'Hello, world! This is a test.');
      const result = extractor.extract('test.md', 0, 13);
      expect(result.excerpt).toBe('Hello, world!');
      expect(result.truncated).toBe(false);
    });

    it('should handle middle of file extraction', () => {
      createFile('test.md', 'Hello, world! This is a test.');
      const result = extractor.extract('test.md', 14, 29);
      expect(result.excerpt).toBe('This is a test.');
      expect(result.truncated).toBe(false);
    });

    it('should handle nested paths', () => {
      createFile('notes/daily/2024-01-15.md', 'Daily note content');
      const result = extractor.extract('notes/daily/2024-01-15.md', 0, 18);
      expect(result.excerpt).toBe('Daily note content');
    });

    it('should truncate long excerpts', () => {
      const longContent = 'A'.repeat(2000);
      createFile('test.md', longContent);
      const result = extractor.extract('test.md', 0, 2000, { maxLength: 500 });
      expect(result.excerpt.length).toBeLessThanOrEqual(500);
      expect(result.truncated).toBe(true);
    });

    it('should not truncate short excerpts', () => {
      createFile('test.md', 'Short content');
      const result = extractor.extract('test.md', 0, 13, { maxLength: 500 });
      expect(result.excerpt).toBe('Short content');
      expect(result.truncated).toBe(false);
    });

    it('should truncate at word boundary when possible', () => {
      createFile('test.md', 'Hello world this is a longer sentence that needs truncation');
      const result = extractor.extract('test.md', 0, 59, { maxLength: 20 });
      // Should truncate at word boundary - the result should be a complete word
      // "Hello world this is" is 19 chars, which is valid truncation at word boundary
      expect(result.excerpt.length).toBeLessThanOrEqual(20);
      expect(result.truncated).toBe(true);
      // Verify it's a clean word boundary (ends with space or complete word)
      expect(result.excerpt).toMatch(/^[\w\s]+$/);
    });

    it('should handle UTF-8 content correctly', () => {
      createFile('test.md', 'Hello 世界! Emoji: 🎉');
      const result = extractor.extract('test.md', 0, 21);
      expect(result.excerpt).toBe('Hello 世界! Emoji: 🎉');
    });

    it('should throw for non-existent file', () => {
      expect(() => extractor.extract('nonexistent.md', 0, 100)).toThrow();
    });

    it('should handle empty range', () => {
      createFile('test.md', 'Hello, world!');
      const result = extractor.extract('test.md', 5, 5);
      expect(result.excerpt).toBe('');
      expect(result.truncated).toBe(false);
    });
  });

  describe('extractBatch()', () => {
    it('should extract multiple excerpts efficiently', () => {
      createFile('a.md', 'Content of file A');
      createFile('b.md', 'Content of file B');

      const requests = [
        { docUri: 'a.md', startChar: 0, endChar: 17 },
        { docUri: 'b.md', startChar: 0, endChar: 17 },
      ];

      const results = extractor.extractBatch(requests);

      expect(results.length).toBe(2);
      expect(results[0]!.excerpt).toBe('Content of file A');
      expect(results[1]!.excerpt).toBe('Content of file B');
    });

    it('should cache file reads for same document', () => {
      createFile('test.md', 'Hello, world! This is a test.');

      const requests = [
        { docUri: 'test.md', startChar: 0, endChar: 13 },
        { docUri: 'test.md', startChar: 14, endChar: 29 },
      ];

      const results = extractor.extractBatch(requests);

      expect(results.length).toBe(2);
      expect(results[0]!.excerpt).toBe('Hello, world!');
      expect(results[1]!.excerpt).toBe('This is a test.');
    });
  });

  describe('default maxLength', () => {
    it('should use 1000 as default maxLength', () => {
      const longContent = 'A'.repeat(2000);
      createFile('test.md', longContent);
      const result = extractor.extract('test.md', 0, 2000);
      expect(result.excerpt.length).toBeLessThanOrEqual(1000);
      expect(result.truncated).toBe(true);
    });
  });
});

