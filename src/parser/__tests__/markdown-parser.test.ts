/**
 * Markdown Parser Tests
 *
 * TDD: These tests define the expected behavior of the MarkdownParser class.
 */

import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../markdown-parser.js';
import { HEADING_PATH_SEPARATOR } from '../../types.js';

describe('MarkdownParser', () => {
  const parser = new MarkdownParser();

  describe('normalize()', () => {
    it('should normalize CRLF to LF', () => {
      const input = 'Line 1\r\nLine 2\r\nLine 3';
      const result = parser.normalize(input);
      expect(result).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should normalize CR to LF', () => {
      const input = 'Line 1\rLine 2\rLine 3';
      const result = parser.normalize(input);
      expect(result).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should strip BOM', () => {
      const input = '\uFEFFContent with BOM';
      const result = parser.normalize(input);
      expect(result).toBe('Content with BOM\n');
    });

    it('should ensure trailing newline', () => {
      const input = 'No trailing newline';
      const result = parser.normalize(input);
      expect(result).toBe('No trailing newline\n');
    });

    it('should not add extra trailing newline if already present', () => {
      const input = 'Has trailing newline\n';
      const result = parser.normalize(input);
      expect(result).toBe('Has trailing newline\n');
    });

    it('should preserve empty file as single newline', () => {
      const input = '';
      const result = parser.normalize(input);
      expect(result).toBe('\n');
    });
  });

  describe('parseHeadings()', () => {
    const docUri = 'test/doc.md';

    it('should create virtual root for document without headings', () => {
      const text = 'Just some text\nwithout any headings.\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.docUri).toBe(docUri);
      expect(tree.root.level).toBe(0);
      expect(tree.root.title).toBe('');
      expect(tree.root.headingPath).toBe('');
      expect(tree.root.startChar).toBe(0);
      expect(tree.root.endChar).toBe(text.length);
      expect(tree.root.children).toHaveLength(0);
    });

    it('should parse a single h1 heading', () => {
      const text = '# Main Title\n\nSome content.\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.root.children).toHaveLength(1);
      const h1 = tree.root.children[0]!;
      expect(h1.level).toBe(1);
      expect(h1.title).toBe('Main Title');
      expect(h1.headingPath).toBe('Main Title');
      expect(h1.startChar).toBe(0);
      expect(h1.endChar).toBe(text.length);
    });

    it('should parse multiple sibling headings', () => {
      const text = '# First\n\nContent 1\n\n# Second\n\nContent 2\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.root.children).toHaveLength(2);
      expect(tree.root.children[0]!.title).toBe('First');
      expect(tree.root.children[1]!.title).toBe('Second');
    });

    it('should build nested heading hierarchy', () => {
      const text = '# H1\n\n## H2\n\n### H3\n\nContent\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.root.children).toHaveLength(1);
      const h1 = tree.root.children[0]!;
      expect(h1.title).toBe('H1');
      expect(h1.children).toHaveLength(1);

      const h2 = h1.children[0]!;
      expect(h2.title).toBe('H2');
      expect(h2.headingPath).toBe(`H1${HEADING_PATH_SEPARATOR}H2`);
      expect(h2.children).toHaveLength(1);

      const h3 = h2.children[0]!;
      expect(h3.title).toBe('H3');
      expect(h3.headingPath).toBe(`H1${HEADING_PATH_SEPARATOR}H2${HEADING_PATH_SEPARATOR}H3`);
    });

    it('should handle heading level jumps (h1 -> h3)', () => {
      const text = '# H1\n\n### H3 (skipped h2)\n\nContent\n';
      const tree = parser.parseHeadings(docUri, text);

      const h1 = tree.root.children[0]!;
      expect(h1.children).toHaveLength(1);
      const h3 = h1.children[0]!;
      expect(h3.level).toBe(3);
      expect(h3.headingPath).toBe(`H1${HEADING_PATH_SEPARATOR}H3 (skipped h2)`);
    });

    it('should handle heading level decrease (h3 -> h1)', () => {
      const text = '# First H1\n\n## H2\n\n### H3\n\n# Second H1\n\nContent\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.root.children).toHaveLength(2);
      expect(tree.root.children[0]!.title).toBe('First H1');
      expect(tree.root.children[1]!.title).toBe('Second H1');
    });

    it('should ignore headings inside fenced code blocks', () => {
      const text = '# Real Heading\n\n```markdown\n# Fake Heading\n```\n\nContent\n';
      const tree = parser.parseHeadings(docUri, text);

      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children[0]!.title).toBe('Real Heading');
    });

    it('should calculate correct character offsets', () => {
      const text = '# First\n\nContent 1\n\n# Second\n\nContent 2\n';
      const tree = parser.parseHeadings(docUri, text);

      const first = tree.root.children[0]!;
      const second = tree.root.children[1]!;

      // First heading starts at 0, ends where second starts
      expect(first.startChar).toBe(0);
      expect(first.endChar).toBe(text.indexOf('# Second'));

      // Second heading starts at its position, ends at EOF
      expect(second.startChar).toBe(text.indexOf('# Second'));
      expect(second.endChar).toBe(text.length);
    });

    it('should generate deterministic nodeId', () => {
      const text = '# Heading\n\nContent\n';
      const tree1 = parser.parseHeadings(docUri, text);
      const tree2 = parser.parseHeadings(docUri, text);

      expect(tree1.root.children[0]!.nodeId).toBe(tree2.root.children[0]!.nodeId);
    });
  });
});

