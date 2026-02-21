/**
 * Fence Detector Tests
 *
 * TDD: These tests define the expected behavior of the FenceDetector class.
 * The implementation should make all these tests pass.
 */

import { describe, it, expect } from 'vitest';
import { FenceDetector, type FencedRegion } from '../fence-detector.js';

describe('FenceDetector', () => {
  const detector = new FenceDetector();

  describe('detect()', () => {
    it('should return empty array for text without fences', () => {
      const text = 'This is plain text\nwith multiple lines\nbut no code fences.';
      const regions = detector.detect(text);
      expect(regions).toEqual([]);
    });

    it('should detect a basic fenced code block with backticks', () => {
      const text = 'Before\n```\ncode here\n```\nAfter';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
      expect(regions[0]).toMatchObject({
        startChar: 7, // position of first ```
        endChar: 24, // position after closing ```
        language: null,
      });
    });

    it('should detect a fenced code block with language tag', () => {
      const text = 'Before\n```typescript\nconst x = 1;\n```\nAfter';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
      expect(regions[0]?.language).toBe('typescript');
    });

    it('should detect multiple fenced code blocks', () => {
      const text = '```js\ncode1\n```\n\nText between\n\n```python\ncode2\n```';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(2);
      expect(regions[0]?.language).toBe('js');
      expect(regions[1]?.language).toBe('python');
    });

    it('should detect fenced blocks with tildes', () => {
      const text = 'Before\n~~~\ncode here\n~~~\nAfter';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
    });

    it('should detect fenced blocks with more than 3 backticks', () => {
      const text = 'Before\n````\ncode with ``` inside\n````\nAfter';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
      // The inner ``` should NOT close the fence
      expect(text.slice(regions[0]!.startChar, regions[0]!.endChar)).toContain('code with ``` inside');
    });

    it('should handle unclosed fence at end of document', () => {
      const text = 'Before\n```\ncode without closing fence';
      const regions = detector.detect(text);
      // Unclosed fence extends to end of document
      expect(regions).toHaveLength(1);
      expect(regions[0]?.endChar).toBe(text.length);
    });

    it('should require fence to start at beginning of line', () => {
      // Inline ``` (not at line start) should not be detected as fence opening
      const text = 'Before text ``` not a fence';
      const regions = detector.detect(text);
      // ``` not at line start should not be detected as fence
      expect(regions).toEqual([]);
    });

    it('should not treat inline backticks as fence', () => {
      // Text with inline code (single backticks) should not be detected
      const text = 'Use `code` inline and ```triple``` too';
      const regions = detector.detect(text);
      expect(regions).toEqual([]);
    });

    it('should allow leading whitespace before fence', () => {
      const text = 'Before\n  ```\ncode\n  ```\nAfter';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
    });

    it('should handle empty fenced block', () => {
      const text = '```\n```';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
    });

    it('should handle fence with only language tag', () => {
      const text = '```json\n{"key": "value"}\n```';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
      expect(regions[0]?.language).toBe('json');
    });

    it('should handle language tag with extra info (e.g., filename)', () => {
      const text = '```typescript title="example.ts"\nconst x = 1;\n```';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(1);
      // Language should be just "typescript", not the whole info string
      expect(regions[0]?.language).toBe('typescript');
    });
  });

  describe('isInsideFence()', () => {
    it('should return false for offset before any fence', () => {
      const text = 'Before\n```\ncode\n```\nAfter';
      const regions = detector.detect(text);
      expect(detector.isInsideFence(0, regions)).toBe(false);
      expect(detector.isInsideFence(5, regions)).toBe(false);
    });

    it('should return true for offset inside fence', () => {
      const text = 'Before\n```\ncode\n```\nAfter';
      const regions = detector.detect(text);
      // "code" starts at position 11
      expect(detector.isInsideFence(11, regions)).toBe(true);
      expect(detector.isInsideFence(14, regions)).toBe(true);
    });

    it('should return false for offset after fence', () => {
      const text = 'Before\n```\ncode\n```\nAfter';
      const regions = detector.detect(text);
      // "After" starts at position 20
      expect(detector.isInsideFence(20, regions)).toBe(false);
    });

    it('should return true for offset at fence boundary (inclusive start)', () => {
      const text = 'Before\n```\ncode\n```\nAfter';
      const regions = detector.detect(text);
      // Fence starts at position 7
      expect(detector.isInsideFence(7, regions)).toBe(true);
    });

    it('should return false for offset at fence end (exclusive)', () => {
      const text = 'Before\n```\ncode\n```\nAfter';
      const regions = detector.detect(text);
      const endChar = regions[0]!.endChar;
      expect(detector.isInsideFence(endChar, regions)).toBe(false);
    });

    it('should handle multiple fences correctly', () => {
      const text = '```\ncode1\n```\ntext\n```\ncode2\n```';
      const regions = detector.detect(text);
      expect(regions).toHaveLength(2);
      // "text" is between fences
      const textStart = text.indexOf('text');
      expect(detector.isInsideFence(textStart, regions)).toBe(false);
    });
  });
});

