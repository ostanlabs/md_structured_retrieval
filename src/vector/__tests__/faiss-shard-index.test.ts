/**
 * FaissShardIndex Tests
 *
 * TDD: These tests define the expected behavior of the FAISS shard index.
 * Note: Integration tests require faiss-node to be installed and properly built.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FaissShardIndex,
  DEFAULT_FAISS_CONFIG,
  selectIndexType,
  computeNlist,
  MIN_VECTORS_FOR_IVFPQ,
} from '../faiss-shard-index.js';
import type { VectorSearchResult } from '../vector-index.js';

// Check if faiss-node is available (native module may not be built on all platforms)
let hasFaissNode = false;
try {
  require('faiss-node');
  hasFaissNode = true;
} catch {
  // faiss-node not available or native module not built
}

describe('selectIndexType', () => {
  it('should return flat for small shard', () => {
    expect(selectIndexType(100)).toBe('flat');
    expect(selectIndexType(500)).toBe('flat');
    expect(selectIndexType(999)).toBe('flat');
  });

  it('should return ivfpq for large shard', () => {
    expect(selectIndexType(1000)).toBe('ivfpq');
    expect(selectIndexType(5000)).toBe('ivfpq');
    expect(selectIndexType(100000)).toBe('ivfpq');
  });

  it('should use MIN_VECTORS_FOR_IVFPQ threshold', () => {
    expect(selectIndexType(MIN_VECTORS_FOR_IVFPQ - 1)).toBe('flat');
    expect(selectIndexType(MIN_VECTORS_FOR_IVFPQ)).toBe('ivfpq');
  });
});

describe('computeNlist', () => {
  it('should compute sqrt of shard size', () => {
    expect(computeNlist(1000)).toBe(31); // sqrt(1000) ≈ 31.6
    expect(computeNlist(10000)).toBe(100); // sqrt(10000) = 100
  });

  it('should cap at 256', () => {
    expect(computeNlist(100000)).toBe(256); // sqrt(100000) ≈ 316, capped at 256
    expect(computeNlist(1000000)).toBe(256);
  });

  it('should return at least 1', () => {
    expect(computeNlist(1)).toBeGreaterThanOrEqual(1);
  });
});

describe('DEFAULT_FAISS_CONFIG', () => {
  it('should have correct dimension', () => {
    expect(DEFAULT_FAISS_CONFIG.dimension).toBe(1024);
  });

  it('should have correct PQ parameters', () => {
    expect(DEFAULT_FAISS_CONFIG.m).toBe(64);
    expect(DEFAULT_FAISS_CONFIG.nbits).toBe(8);
  });

  it('should have correct nprobe', () => {
    expect(DEFAULT_FAISS_CONFIG.nprobe).toBe(16);
  });
});

describe('FaissShardIndex', () => {
  describe('interface compliance', () => {
    it('should create index instance', () => {
      const index = new FaissShardIndex();
      expect(index).toBeDefined();
    });

    it('should have size property', () => {
      const index = new FaissShardIndex();
      expect(index.size).toBe(0);
    });

    it('should have required methods', () => {
      const index = new FaissShardIndex();
      expect(typeof index.add).toBe('function');
      expect(typeof index.search).toBe('function');
      expect(typeof index.train).toBe('function');
      expect(typeof index.save).toBe('function');
      expect(typeof index.load).toBe('function');
    });
  });

  // Integration tests that require faiss-node (skip if native module not available)
  describe.skipIf(!hasFaissNode)('with faiss-node (integration)', () => {
    let tempDir: string;
    let index: FaissShardIndex;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-faiss-test-'));
      index = new FaissShardIndex();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should add vectors and search', async () => {
      await index.initialize();

      // Helper to normalize a vector (required for cosine similarity via inner product)
      const normalize = (v: Float32Array): Float32Array => {
        let norm = 0;
        for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
        norm = Math.sqrt(norm);
        const result = new Float32Array(v.length);
        for (let i = 0; i < v.length; i++) result[i] = v[i]! / norm;
        return result;
      };

      // Create random normalized vectors
      const vectors: Float32Array[] = [];
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        const v = new Float32Array(1024);
        for (let j = 0; j < 1024; j++) {
          v[j] = Math.random();
        }
        vectors.push(normalize(v));
        ids.push(`leaf_${i}`);
      }

      // Add vectors
      index.add(ids, vectors);
      expect(index.size).toBe(100);

      // Search
      const query = vectors[0]!;
      const results = index.search(query, 5);

      expect(results.length).toBe(5);
      expect(results[0]!.id).toBe('leaf_0'); // Should find itself
      expect(results[0]!.score).toBeCloseTo(1.0, 2); // Self-similarity (normalized vectors)
    });

    it('should save and load index', async () => {
      await index.initialize();

      // Add some vectors
      const vectors: Float32Array[] = [];
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const v = new Float32Array(1024);
        for (let j = 0; j < 1024; j++) {
          v[j] = Math.random();
        }
        vectors.push(v);
        ids.push(`leaf_${i}`);
      }
      index.add(ids, vectors);

      // Save
      const indexPath = path.join(tempDir, 'test.faiss');
      index.save(indexPath);
      expect(fs.existsSync(indexPath)).toBe(true);

      // Load into new index
      const loadedIndex = new FaissShardIndex();
      loadedIndex.load(indexPath);
      expect(loadedIndex.size).toBe(50);
    });
  });
});

