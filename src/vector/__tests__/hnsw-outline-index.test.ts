/**
 * HnswOutlineIndex Tests
 *
 * TDD: These tests define the expected behavior of the HNSW outline index.
 * Note: Integration tests require faiss-node to be installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  HnswOutlineIndex,
  DEFAULT_HNSW_CONFIG,
} from '../hnsw-outline-index.js';
import type { VectorSearchResult } from '../vector-index.js';

describe('DEFAULT_HNSW_CONFIG', () => {
  it('should have correct dimension', () => {
    expect(DEFAULT_HNSW_CONFIG.dimension).toBe(1024);
  });

  it('should have correct HNSW parameters', () => {
    expect(DEFAULT_HNSW_CONFIG.m).toBe(32); // connections per layer
    expect(DEFAULT_HNSW_CONFIG.efConstruction).toBe(200);
    expect(DEFAULT_HNSW_CONFIG.efSearch).toBe(64);
  });
});

describe('HnswOutlineIndex', () => {
  describe('interface compliance', () => {
    it('should create index instance', () => {
      const index = new HnswOutlineIndex();
      expect(index).toBeDefined();
    });

    it('should have size property', () => {
      const index = new HnswOutlineIndex();
      expect(index.size).toBe(0);
    });

    it('should have required methods', () => {
      const index = new HnswOutlineIndex();
      expect(typeof index.add).toBe('function');
      expect(typeof index.search).toBe('function');
      expect(typeof index.train).toBe('function');
      expect(typeof index.save).toBe('function');
      expect(typeof index.load).toBe('function');
    });

    it('should have routing methods', () => {
      const index = new HnswOutlineIndex();
      expect(typeof index.setNodeShardMap).toBe('function');
      expect(typeof index.route).toBe('function');
    });
  });

  describe('node-shard mapping', () => {
    it('should store node to shard mapping', () => {
      const index = new HnswOutlineIndex();
      const map = new Map<string, number[]>();
      map.set('node_1', [0, 1, 2]);
      map.set('node_2', [3, 4]);

      index.setNodeShardMap(map);

      // Verify mapping is stored (internal state)
      expect(index.getNodeShards('node_1')).toEqual([0, 1, 2]);
      expect(index.getNodeShards('node_2')).toEqual([3, 4]);
    });

    it('should return empty array for unknown node', () => {
      const index = new HnswOutlineIndex();
      expect(index.getNodeShards('unknown')).toEqual([]);
    });
  });

  // Integration tests that require faiss-node
  describe('with faiss-node (integration)', () => {
    let tempDir: string;
    let index: HnswOutlineIndex;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-hnsw-test-'));
      index = new HnswOutlineIndex();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should add vectors and search', async () => {
      await index.initialize();

      // Create random vectors
      const vectors: Float32Array[] = [];
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const v = new Float32Array(1024);
        for (let j = 0; j < 1024; j++) {
          v[j] = Math.random();
        }
        vectors.push(v);
        ids.push(`node_${i}`);
      }

      // Add vectors
      index.add(ids, vectors);
      expect(index.size).toBe(50);

      // Search
      const query = vectors[0]!;
      const results = index.search(query, 5);

      expect(results.length).toBe(5);
      expect(results[0]!.id).toBe('node_0'); // Should find itself
    });

    it('should route query to relevant shards', async () => {
      await index.initialize();

      // Create vectors and add
      const vectors: Float32Array[] = [];
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const v = new Float32Array(1024);
        for (let j = 0; j < 1024; j++) {
          v[j] = Math.random();
        }
        vectors.push(v);
        ids.push(`node_${i}`);
      }
      index.add(ids, vectors);

      // Set up node-shard mapping
      const map = new Map<string, number[]>();
      map.set('node_0', [0, 1]);
      map.set('node_1', [1, 2]);
      map.set('node_2', [2, 3]);
      index.setNodeShardMap(map);

      // Route query
      const shards = index.route(vectors[0]!, 3, 8);

      // Should return deduplicated shard IDs
      expect(shards.length).toBeGreaterThan(0);
      expect(shards.length).toBeLessThanOrEqual(8);
    });

    it('should save and load index', async () => {
      await index.initialize();

      // Add some vectors
      const vectors: Float32Array[] = [];
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const v = new Float32Array(1024);
        for (let j = 0; j < 1024; j++) {
          v[j] = Math.random();
        }
        vectors.push(v);
        ids.push(`node_${i}`);
      }
      index.add(ids, vectors);

      // Save
      const indexPath = path.join(tempDir, 'outline.faiss');
      index.save(indexPath);
      expect(fs.existsSync(indexPath)).toBe(true);

      // Load into new index
      const loadedIndex = new HnswOutlineIndex();
      loadedIndex.load(indexPath);
      expect(loadedIndex.size).toBe(20);
    });
  });
});

