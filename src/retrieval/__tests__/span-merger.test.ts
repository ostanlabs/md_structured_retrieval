/**
 * Span Merger Tests
 *
 * TDD: These tests define the expected behavior of the span merging system
 * that combines adjacent/overlapping search result spans.
 */

import { describe, it, expect } from 'vitest';
import { SpanMerger, Span, MergedSpan } from '../span-merger.js';

describe('SpanMerger', () => {
  const merger = new SpanMerger();

  describe('merge()', () => {
    it('should return empty array for empty input', () => {
      const result = merger.merge([]);
      expect(result).toEqual([]);
    });

    it('should return single span unchanged', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(1);
      expect(result[0]!.startChar).toBe(0);
      expect(result[0]!.endChar).toBe(100);
    });

    it('should merge overlapping spans in same document', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 50, endChar: 150, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(1);
      expect(result[0]!.startChar).toBe(0);
      expect(result[0]!.endChar).toBe(150);
    });

    it('should merge adjacent spans (touching boundaries)', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 100, endChar: 200, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(1);
      expect(result[0]!.startChar).toBe(0);
      expect(result[0]!.endChar).toBe(200);
    });

    it('should NOT merge non-overlapping spans', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 200, endChar: 300, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(2);
    });

    it('should NOT merge spans from different documents', () => {
      const spans: Span[] = [
        { docUri: 'a.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'b.md', startChar: 50, endChar: 150, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(2);
    });

    it('should use max score for merged span', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.7, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 50, endChar: 150, score: 0.9, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result[0]!.score).toBe(0.9);
    });

    it('should combine leafIds from merged spans', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1', 'l2'] },
        { docUri: 'test.md', startChar: 50, endChar: 150, score: 0.8, leafIds: ['l2', 'l3'] },
      ];
      const result = merger.merge(spans);
      expect(result[0]!.leafIds.sort()).toEqual(['l1', 'l2', 'l3']);
    });

    it('should handle multiple merge groups', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 50, endChar: 150, score: 0.8, leafIds: ['l2'] },
        { docUri: 'test.md', startChar: 300, endChar: 400, score: 0.7, leafIds: ['l3'] },
        { docUri: 'test.md', startChar: 350, endChar: 450, score: 0.6, leafIds: ['l4'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(2);
      expect(result[0]!.startChar).toBe(0);
      expect(result[0]!.endChar).toBe(150);
      expect(result[1]!.startChar).toBe(300);
      expect(result[1]!.endChar).toBe(450);
    });

    it('should sort results by score descending', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.5, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 200, endChar: 300, score: 0.9, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result[0]!.score).toBe(0.9);
      expect(result[1]!.score).toBe(0.5);
    });

    it('should handle contained spans (one inside another)', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 200, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 50, endChar: 100, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.merge(spans);
      expect(result.length).toBe(1);
      expect(result[0]!.startChar).toBe(0);
      expect(result[0]!.endChar).toBe(200);
    });
  });

  describe('mergeWithGap()', () => {
    it('should merge spans within gap threshold', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 110, endChar: 200, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.mergeWithGap(spans, 20); // 10 char gap, within threshold
      expect(result.length).toBe(1);
    });

    it('should NOT merge spans beyond gap threshold', () => {
      const spans: Span[] = [
        { docUri: 'test.md', startChar: 0, endChar: 100, score: 0.9, leafIds: ['l1'] },
        { docUri: 'test.md', startChar: 150, endChar: 200, score: 0.8, leafIds: ['l2'] },
      ];
      const result = merger.mergeWithGap(spans, 20); // 50 char gap, beyond threshold
      expect(result.length).toBe(2);
    });
  });
});

