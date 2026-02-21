/**
 * Hybrid Scorer Tests
 *
 * TDD: These tests define the expected behavior of the hybrid scoring system
 * that combines vector similarity and BM25 lexical scores.
 */

import { describe, it, expect } from 'vitest';
import {
  HybridScorer,
  VectorResult,
  BM25Result,
  HybridResult,
  DEFAULT_HYBRID_WEIGHTS,
} from '../hybrid-scorer.js';

describe('HybridScorer', () => {
  describe('DEFAULT_HYBRID_WEIGHTS', () => {
    it('should have vector weight of 0.7', () => {
      expect(DEFAULT_HYBRID_WEIGHTS.vector).toBe(0.7);
    });

    it('should have bm25 weight of 0.3', () => {
      expect(DEFAULT_HYBRID_WEIGHTS.bm25).toBe(0.3);
    });

    it('should sum to 1.0', () => {
      expect(DEFAULT_HYBRID_WEIGHTS.vector + DEFAULT_HYBRID_WEIGHTS.bm25).toBe(1.0);
    });
  });

  describe('fuse()', () => {
    const scorer = new HybridScorer();

    it('should combine vector and BM25 results', () => {
      const vectorResults: VectorResult[] = [
        { leafId: 'l1', vectorScore: 0.9 },
        { leafId: 'l2', vectorScore: 0.7 },
      ];
      const bm25Results: BM25Result[] = [
        { leafId: 'l1', bm25Score: 0.8 },
        { leafId: 'l3', bm25Score: 0.6 },
      ];

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results.length).toBe(3); // l1, l2, l3
      expect(results.map((r) => r.leafId).sort()).toEqual(['l1', 'l2', 'l3']);
    });

    it('should calculate hybrid score using weighted fusion', () => {
      const vectorResults: VectorResult[] = [{ leafId: 'l1', vectorScore: 1.0 }];
      const bm25Results: BM25Result[] = [{ leafId: 'l1', bm25Score: 1.0 }];

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results[0]!.score).toBe(1.0); // 0.7 * 1.0 + 0.3 * 1.0 = 1.0
    });

    it('should use 0 for missing BM25 score', () => {
      const vectorResults: VectorResult[] = [{ leafId: 'l1', vectorScore: 1.0 }];
      const bm25Results: BM25Result[] = []; // No BM25 match

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results[0]!.score).toBe(0.7); // 0.7 * 1.0 + 0.3 * 0 = 0.7
      expect(results[0]!.bm25Score).toBe(0);
    });

    it('should compute vector score from embedding for BM25-only results', () => {
      // When a result only has BM25 score, we need to compute vector score
      // from the cached embedding. This test verifies the interface.
      const vectorResults: VectorResult[] = [];
      const bm25Results: BM25Result[] = [
        { leafId: 'l1', bm25Score: 1.0, cachedVectorScore: 0.5 },
      ];

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results[0]!.vectorScore).toBe(0.5);
      expect(results[0]!.score).toBe(0.7 * 0.5 + 0.3 * 1.0); // 0.65
    });

    it('should sort results by hybrid score descending', () => {
      const vectorResults: VectorResult[] = [
        { leafId: 'l1', vectorScore: 0.5 },
        { leafId: 'l2', vectorScore: 0.9 },
      ];
      const bm25Results: BM25Result[] = [
        { leafId: 'l1', bm25Score: 0.9 },
        { leafId: 'l2', bm25Score: 0.1 },
      ];

      const results = scorer.fuse(vectorResults, bm25Results);

      // l1: 0.7 * 0.5 + 0.3 * 0.9 = 0.35 + 0.27 = 0.62
      // l2: 0.7 * 0.9 + 0.3 * 0.1 = 0.63 + 0.03 = 0.66
      expect(results[0]!.leafId).toBe('l2');
      expect(results[1]!.leafId).toBe('l1');
    });

    it('should preserve individual scores in result', () => {
      const vectorResults: VectorResult[] = [{ leafId: 'l1', vectorScore: 0.8 }];
      const bm25Results: BM25Result[] = [{ leafId: 'l1', bm25Score: 0.6 }];

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results[0]!.vectorScore).toBe(0.8);
      expect(results[0]!.bm25Score).toBe(0.6);
    });
  });

  describe('custom weights', () => {
    it('should allow custom vector/bm25 weights', () => {
      const scorer = new HybridScorer({ vector: 0.5, bm25: 0.5 });

      const vectorResults: VectorResult[] = [{ leafId: 'l1', vectorScore: 1.0 }];
      const bm25Results: BM25Result[] = [{ leafId: 'l1', bm25Score: 0.0 }];

      const results = scorer.fuse(vectorResults, bm25Results);

      expect(results[0]!.score).toBe(0.5); // 0.5 * 1.0 + 0.5 * 0.0 = 0.5
    });

    it('should validate weights sum to 1.0', () => {
      expect(() => new HybridScorer({ vector: 0.6, bm25: 0.6 })).toThrow();
    });
  });

  describe('tie-breaking', () => {
    it('should use leafId for stable tie-breaking', () => {
      const scorer = new HybridScorer();
      const vectorResults: VectorResult[] = [
        { leafId: 'b', vectorScore: 0.5 },
        { leafId: 'a', vectorScore: 0.5 },
      ];
      const bm25Results: BM25Result[] = [
        { leafId: 'b', bm25Score: 0.5 },
        { leafId: 'a', bm25Score: 0.5 },
      ];

      const results = scorer.fuse(vectorResults, bm25Results);

      // Same score, should be sorted by leafId for stability
      expect(results[0]!.leafId).toBe('a');
      expect(results[1]!.leafId).toBe('b');
    });
  });
});

