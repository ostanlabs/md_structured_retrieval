/**
 * Chunker Tests
 *
 * TDD: These tests define the expected behavior of the Chunker class.
 */

import { describe, it, expect, vi } from 'vitest';
import { Chunker, DEFAULT_CHUNKER_CONFIG } from '../chunker.js';
import { FenceDetector } from '../fence-detector.js';
import type { HeadingNode, Chunk } from '../../types.js';

// Simple token counter: ~4 chars per token (approximation)
const simpleTokenCounter = (text: string): number => Math.ceil(text.length / 4);

describe('Chunker', () => {
  const fenceDetector = new FenceDetector();

  // Helper to create a heading node
  function createNode(
    startChar: number,
    endChar: number,
    headingPath = 'Test',
    children: HeadingNode[] = [],
  ): HeadingNode {
    return {
      nodeId: 'test-node-id',
      level: 1,
      title: 'Test',
      headingPath,
      startChar,
      endChar,
      children,
    };
  }

  describe('basic chunking', () => {
    it('should create a single chunk for small text', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Test\n\nShort paragraph.\n';
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.text).toContain('Short paragraph');
    });

    it('should extract text after heading line', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Heading\n\nContent after heading.\n';
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      expect(chunks).toHaveLength(1);
      // Should not include the heading line itself
      expect(chunks[0]!.text).not.toContain('# Heading');
      expect(chunks[0]!.text).toContain('Content after heading');
    });

    it('should return empty array for node with no content', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Heading\n';
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      expect(chunks).toHaveLength(0);
    });

    it('should stop at first child node', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Parent\n\nParent content.\n\n## Child\n\nChild content.\n';
      const childStart = text.indexOf('## Child');
      const childNode = createNode(childStart, text.length, 'Parent → Child');
      const parentNode = createNode(0, text.length, 'Parent', [childNode]);

      const chunks = chunker.chunkNode('test.md', parentNode, text, 0);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.text).toContain('Parent content');
      expect(chunks[0]!.text).not.toContain('Child content');
    });
  });

  describe('paragraph splitting', () => {
    it('should split at paragraph boundaries when exceeding target', () => {
      // Use small token limits to force splitting
      const config = {
        ...DEFAULT_CHUNKER_CONFIG,
        targetMinTokens: 5,
        targetMaxTokens: 20,
        hardMaxTokens: 30,
        minPreferredTokens: 3,
        overlapTokens: 2,
      };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      // Create text with multiple paragraphs (~100 chars each = ~25 tokens each)
      const para1 = 'A'.repeat(80);
      const para2 = 'B'.repeat(80);
      const para3 = 'C'.repeat(80);
      const text = `# Test\n\n${para1}\n\n${para2}\n\n${para3}\n`;
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      // Should create multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('fence integrity', () => {
    it('should not split inside fenced code blocks', () => {
      const config = {
        ...DEFAULT_CHUNKER_CONFIG,
        targetMinTokens: 5,
        targetMaxTokens: 20,
        hardMaxTokens: 1000, // High to allow large fence
      };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      // Create a large fenced block that would normally be split
      const codeContent = 'x'.repeat(200);
      const text = `# Test\n\n\`\`\`\n${codeContent}\n\`\`\`\n`;
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      // The fence should be kept intact
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.text).toContain('```');
      expect(chunks[0]!.text).toContain(codeContent);
    });
  });

  describe('chunk metadata', () => {
    it('should generate deterministic leafId', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Test\n\nContent.\n';
      const node = createNode(0, text.length);

      const chunks1 = chunker.chunkNode('test.md', node, text, 0);
      const chunks2 = chunker.chunkNode('test.md', node, text, 0);

      expect(chunks1[0]!.leafId).toBe(chunks2[0]!.leafId);
    });

    it('should set correct shardId', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Test\n\nContent.\n';
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 42);

      expect(chunks[0]!.shardId).toBe(42);
    });

    it('should calculate textHash', () => {
      const config = { ...DEFAULT_CHUNKER_CONFIG, targetMinTokens: 10, targetMaxTokens: 100 };
      const chunker = new Chunker(config, fenceDetector, simpleTokenCounter);

      const text = '# Test\n\nContent.\n';
      const node = createNode(0, text.length);

      const chunks = chunker.chunkNode('test.md', node, text, 0);

      expect(chunks[0]!.textHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

