/**
 * FaissShardIndex
 *
 * FAISS-based vector index for leaf shards.
 * Uses IndexFlatIP for small shards (<1000 vectors) and IVFPQ for larger shards.
 */

import type { VectorIndex, VectorSearchResult } from './vector-index.js';

/** Minimum vectors required to use IVFPQ (below this, use flat index) */
export const MIN_VECTORS_FOR_IVFPQ = 1000;

/**
 * Select index type based on shard size.
 */
export function selectIndexType(shardSize: number): 'flat' | 'ivfpq' {
  return shardSize < MIN_VECTORS_FOR_IVFPQ ? 'flat' : 'ivfpq';
}

/**
 * Compute nlist (number of IVF cells) for IVFPQ.
 * Uses sqrt(shardSize), capped at 256.
 */
export function computeNlist(shardSize: number): number {
  return Math.min(256, Math.max(1, Math.floor(Math.sqrt(shardSize))));
}

export interface FaissConfig {
  dimension: number;
  m: number; // PQ subquantizers
  nbits: number; // bits per subquantizer
  nprobe: number; // cells to search at query time
}

export const DEFAULT_FAISS_CONFIG: FaissConfig = {
  dimension: 1024,
  m: 64,
  nbits: 8,
  nprobe: 16,
};

/**
 * FAISS-based vector index for leaf shards.
 */
export class FaissShardIndex implements VectorIndex {
  private index: any = null; // faiss-node index
  private idMap: Map<number, string> = new Map(); // FAISS internal ID → leafId
  private reverseMap: Map<string, number> = new Map(); // leafId → FAISS internal ID
  private nextId = 0;
  private indexType: 'flat' | 'ivfpq' = 'flat';
  private trained = false;

  constructor(private config: FaissConfig = DEFAULT_FAISS_CONFIG) {}

  /**
   * Initialize the FAISS index.
   * Must be called before add() for IVFPQ indexes.
   */
  async initialize(expectedSize?: number): Promise<void> {
    const faiss = await import('faiss-node');

    this.indexType = expectedSize ? selectIndexType(expectedSize) : 'flat';

    if (this.indexType === 'flat') {
      // IndexFlatIP for small shards - brute force, 100% accurate
      // Uses inner product (IP) which equals cosine similarity for normalized vectors
      this.index = new faiss.IndexFlatIP(this.config.dimension);
      this.trained = true; // Flat index doesn't need training
    } else {
      // IVFPQ for large shards - approximate, ~98-99% recall
      // Use Index.fromFactory to create IVFPQ index
      // Factory string: "IVF{nlist},PQ{m}x{nbits}"
      const nlist = computeNlist(expectedSize!);
      const factoryString = `IVF${nlist},PQ${this.config.m}x${this.config.nbits}`;
      this.index = faiss.Index.fromFactory(
        this.config.dimension,
        factoryString,
        faiss.MetricType.METRIC_INNER_PRODUCT
      );
      this.trained = false;
    }
  }

  get size(): number {
    return this.idMap.size;
  }

  add(ids: string[], vectors: Float32Array[]): void {
    if (!this.index) {
      throw new Error('Index not initialized. Call initialize() first.');
    }
    if (this.indexType === 'ivfpq' && !this.trained) {
      throw new Error('IVFPQ index must be trained before adding vectors.');
    }
    if (ids.length !== vectors.length) {
      throw new Error(`ID count (${ids.length}) must match vector count (${vectors.length})`);
    }

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const vector = vectors[i]!;

      if (vector.length !== this.config.dimension) {
        throw new Error(`Vector dimension (${vector.length}) must be ${this.config.dimension}`);
      }

      // Add to FAISS (faiss-node requires regular array, not Float32Array)
      this.index.add(Array.from(vector));

      // Track ID mapping
      const faissId = this.nextId++;
      this.idMap.set(faissId, id);
      this.reverseMap.set(id, faissId);
    }
  }

  search(query: Float32Array, topK: number): VectorSearchResult[] {
    if (!this.index) {
      throw new Error('Index not initialized.');
    }
    if (this.size === 0) {
      return [];
    }
    if (query.length !== this.config.dimension) {
      throw new Error(`Query dimension (${query.length}) must be ${this.config.dimension}`);
    }

    const k = Math.min(topK, this.size);
    // faiss-node requires regular array, not Float32Array
    const result = this.index.search(Array.from(query), k);

    const results: VectorSearchResult[] = [];
    for (let i = 0; i < result.labels.length; i++) {
      const faissId = result.labels[i];
      const score = result.distances[i];
      const id = this.idMap.get(faissId);

      if (id !== undefined && faissId >= 0) {
        results.push({ id, score });
      }
    }

    return results;
  }

  train(trainingVectors: Float32Array[]): void {
    if (!this.index) {
      throw new Error('Index not initialized.');
    }
    if (this.indexType === 'flat') {
      // Flat index doesn't need training
      return;
    }
    if (trainingVectors.length === 0) {
      throw new Error('Training requires at least one vector.');
    }

    // Stack vectors into a single Float32Array for FAISS
    const totalSize = trainingVectors.length * this.config.dimension;
    const stacked = new Float32Array(totalSize);
    for (let i = 0; i < trainingVectors.length; i++) {
      stacked.set(trainingVectors[i]!, i * this.config.dimension);
    }

    this.index.train(stacked);
    this.trained = true;
  }

  save(filePath: string): void {
    if (!this.index) {
      throw new Error('Index not initialized.');
    }

    // Save FAISS index
    this.index.write(filePath);

    // Save ID maps alongside the index
    const mapPath = filePath.replace(/\.faiss$/, '_ids.json');
    const mapData = {
      idMap: Array.from(this.idMap.entries()),
      nextId: this.nextId,
      indexType: this.indexType,
      trained: this.trained,
    };
    const fs = require('node:fs');
    fs.writeFileSync(mapPath, JSON.stringify(mapData));
  }

  load(filePath: string): void {
    const faiss = require('faiss-node');
    const fs = require('node:fs');

    // Load FAISS index using Index.read static method
    this.index = faiss.Index.read(filePath);

    // Load ID maps
    const mapPath = filePath.replace(/\.faiss$/, '_ids.json');
    if (fs.existsSync(mapPath)) {
      const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      this.idMap = new Map(mapData.idMap);
      this.reverseMap = new Map(
        Array.from(this.idMap.entries()).map(([k, v]) => [v, k])
      );
      this.nextId = mapData.nextId;
      this.indexType = mapData.indexType;
      this.trained = mapData.trained;
    }
  }
}

