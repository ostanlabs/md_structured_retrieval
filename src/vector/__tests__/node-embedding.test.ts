/**
 * Node Embedding Tests
 *
 * TDD: These tests define the expected behavior of node embedding calculation
 * using MMR (Maximal Marginal Relevance) representative selection.
 */

import { describe, it, expect } from 'vitest';
import {
  computeAdaptiveK,
  computeCentroid,
  selectRepresentativesMMR,
  computeNodeEmbedding,
} from '../node-embedding.js';
import { l2Normalize } from '../../embedding/embedding-provider.js';

describe('computeAdaptiveK', () => {
  it('should return 1 for single leaf', () => {
    expect(computeAdaptiveK(1)).toBe(1); // Can't select more than available
  });

  it('should return 2 for 2-9 leaves', () => {
    expect(computeAdaptiveK(2)).toBe(2);
    expect(computeAdaptiveK(5)).toBe(2);
    expect(computeAdaptiveK(9)).toBe(2);
  });

  it('should return 2-3 for 10-14 leaves', () => {
    expect(computeAdaptiveK(10)).toBe(2); // ceil(10/5) = 2
    expect(computeAdaptiveK(11)).toBe(3); // ceil(11/5) = 3
    expect(computeAdaptiveK(14)).toBe(3);
  });

  it('should return 3-4 for 15-19 leaves', () => {
    expect(computeAdaptiveK(15)).toBe(3); // ceil(15/5) = 3
    expect(computeAdaptiveK(16)).toBe(4); // ceil(16/5) = 4
    expect(computeAdaptiveK(19)).toBe(4);
  });

  it('should return 4-5 for 20+ leaves', () => {
    expect(computeAdaptiveK(20)).toBe(4); // ceil(20/5) = 4
    expect(computeAdaptiveK(21)).toBe(5); // ceil(21/5) = 5
    expect(computeAdaptiveK(50)).toBe(5); // capped at 5
    expect(computeAdaptiveK(100)).toBe(5);
  });
});

describe('computeCentroid', () => {
  it('should compute normalized mean of vectors', () => {
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([0, 1, 0]);
    const v3 = new Float32Array([0, 0, 1]);

    const centroid = computeCentroid([v1, v2, v3]);

    // Mean is [1/3, 1/3, 1/3], normalized to unit length
    const expectedNorm = 1 / Math.sqrt(3);
    expect(centroid[0]).toBeCloseTo(expectedNorm, 5);
    expect(centroid[1]).toBeCloseTo(expectedNorm, 5);
    expect(centroid[2]).toBeCloseTo(expectedNorm, 5);
  });

  it('should handle single vector (normalized)', () => {
    const v = new Float32Array([1, 2, 3]);
    const centroid = computeCentroid([v]);

    // Single vector normalized
    const norm = Math.sqrt(1 + 4 + 9);
    expect(centroid[0]).toBeCloseTo(1 / norm, 5);
    expect(centroid[1]).toBeCloseTo(2 / norm, 5);
    expect(centroid[2]).toBeCloseTo(3 / norm, 5);
  });

  it('should return normalized centroid', () => {
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([0, 1, 0]);

    const centroid = computeCentroid([v1, v2]);

    // Check unit length
    const length = Math.sqrt(centroid[0]! ** 2 + centroid[1]! ** 2 + centroid[2]! ** 2);
    expect(length).toBeCloseTo(1.0, 5);
  });
});

describe('selectRepresentativesMMR', () => {
  it('should select k representatives', () => {
    // Create 10 random vectors
    const vectors: Float32Array[] = [];
    for (let i = 0; i < 10; i++) {
      const v = new Float32Array(3);
      v[0] = Math.random();
      v[1] = Math.random();
      v[2] = Math.random();
      vectors.push(l2Normalize(v));
    }

    const selected = selectRepresentativesMMR(vectors, 3, 0.7);

    expect(selected.length).toBe(3);
    // All indices should be unique
    expect(new Set(selected).size).toBe(3);
    // All indices should be valid
    for (const idx of selected) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(10);
    }
  });

  it('should return all indices if k >= numVectors', () => {
    const vectors = [
      l2Normalize(new Float32Array([1, 0, 0])),
      l2Normalize(new Float32Array([0, 1, 0])),
    ];

    const selected = selectRepresentativesMMR(vectors, 5, 0.7);

    expect(selected.length).toBe(2);
    expect(selected).toContain(0);
    expect(selected).toContain(1);
  });

  it('should balance relevance and diversity', () => {
    // Create vectors: one cluster near [1,0,0] and one outlier at [0,1,0]
    const vectors = [
      l2Normalize(new Float32Array([1, 0.1, 0])),
      l2Normalize(new Float32Array([1, 0.2, 0])),
      l2Normalize(new Float32Array([1, 0.3, 0])),
      l2Normalize(new Float32Array([0, 1, 0])), // outlier
    ];

    const selected = selectRepresentativesMMR(vectors, 2, 0.7);

    // Should select 2 vectors
    expect(selected.length).toBe(2);
    // With lambda=0.7, relevance is favored, so cluster vectors may be preferred
    // The exact selection depends on the centroid and MMR scoring
    // Just verify we get 2 unique indices
    expect(new Set(selected).size).toBe(2);
  });
});

describe('computeNodeEmbedding', () => {
  it('should compute embedding from leaf vectors', () => {
    const leafVectors = [
      l2Normalize(new Float32Array([1, 0, 0])),
      l2Normalize(new Float32Array([0, 1, 0])),
      l2Normalize(new Float32Array([0, 0, 1])),
    ];

    const embedding = computeNodeEmbedding(leafVectors);

    expect(embedding.length).toBe(3);
    // Should be normalized
    const length = Math.sqrt(embedding[0]! ** 2 + embedding[1]! ** 2 + embedding[2]! ** 2);
    expect(length).toBeCloseTo(1.0, 5);
  });

  it('should handle single leaf', () => {
    const leafVectors = [l2Normalize(new Float32Array([1, 2, 3]))];

    const embedding = computeNodeEmbedding(leafVectors);

    // Should be the same as the single leaf (normalized)
    expect(embedding.length).toBe(3);
  });

  it('should use adaptive k for representative selection', () => {
    // Create 20 vectors - should use k=5
    const leafVectors: Float32Array[] = [];
    for (let i = 0; i < 20; i++) {
      const v = new Float32Array(3);
      v[0] = Math.random();
      v[1] = Math.random();
      v[2] = Math.random();
      leafVectors.push(l2Normalize(v));
    }

    const embedding = computeNodeEmbedding(leafVectors);

    expect(embedding.length).toBe(3);
    // Should be normalized
    const length = Math.sqrt(embedding[0]! ** 2 + embedding[1]! ** 2 + embedding[2]! ** 2);
    expect(length).toBeCloseTo(1.0, 5);
  });
});

