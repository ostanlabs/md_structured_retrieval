/**
 * HnswOutlineIndex
 *
 * HNSW-based vector index for outline routing.
 * Used to find relevant heading nodes and route queries to appropriate shards.
 */

import type { VectorIndex, VectorSearchResult } from './vector-index.js';

export interface HnswConfig {
  dimension: number;
  m: number; // HNSW connections per layer
  efConstruction: number; // construction parameter
  efSearch: number; // query parameter
}

export const DEFAULT_HNSW_CONFIG: HnswConfig = {
  dimension: 1024,
  m: 32,
  efConstruction: 200,
  efSearch: 64,
};

/**
 * HNSW-based vector index for outline routing.
 */
export class HnswOutlineIndex implements VectorIndex {
  private index: any = null; // faiss-node HNSW index
  private idMap: Map<number, string> = new Map(); // FAISS internal ID → nodeId
  private reverseMap: Map<string, number> = new Map(); // nodeId → FAISS internal ID
  private nodeToShards: Map<string, number[]> = new Map(); // nodeId → shard IDs
  private nextId = 0;

  constructor(private config: HnswConfig = DEFAULT_HNSW_CONFIG) {}

  /**
   * Initialize the HNSW index.
   */
  async initialize(): Promise<void> {
    const faiss = await import('faiss-node');

    // Create HNSW index using factory
    // Factory string: "HNSW{m}" with inner product metric
    const factoryString = `HNSW${this.config.m}`;
    this.index = faiss.Index.fromFactory(
      this.config.dimension,
      factoryString,
      faiss.MetricType.METRIC_INNER_PRODUCT
    );
  }

  get size(): number {
    return this.idMap.size;
  }

  add(ids: string[], vectors: Float32Array[]): void {
    if (!this.index) {
      throw new Error('Index not initialized. Call initialize() first.');
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

      // Add to FAISS
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
    // HNSW doesn't require training - it's an incremental index
    // This method exists for interface compliance
  }

  /**
   * Set the mapping from node IDs to shard IDs.
   * Each node can have children in multiple shards.
   */
  setNodeShardMap(map: Map<string, number[]>): void {
    this.nodeToShards = new Map(map);
  }

  /**
   * Get shard IDs for a node.
   */
  getNodeShards(nodeId: string): number[] {
    return this.nodeToShards.get(nodeId) ?? [];
  }

  /**
   * Route a query to relevant shards.
   * Searches HNSW for top-N outline nodes, collects their shard IDs,
   * deduplicates, and caps at maxShards.
   */
  route(queryVector: Float32Array, topNodes: number, maxShards: number): number[] {
    const results = this.search(queryVector, topNodes);

    // Collect shard IDs from matched nodes
    const shardSet = new Set<number>();
    for (const result of results) {
      const shards = this.nodeToShards.get(result.id) ?? [];
      for (const shard of shards) {
        shardSet.add(shard);
      }
    }

    // Convert to array and cap at maxShards
    const shards = Array.from(shardSet);
    return shards.slice(0, maxShards);
  }


  save(filePath: string): void {
    if (!this.index) {
      throw new Error('Index not initialized.');
    }

    // Save FAISS index
    this.index.write(filePath);

    // Save ID maps and node-shard mapping alongside the index
    const mapPath = filePath.replace(/\.faiss$/, '_ids.json');
    const mapData = {
      idMap: Array.from(this.idMap.entries()),
      nodeToShards: Array.from(this.nodeToShards.entries()),
      nextId: this.nextId,
    };
    const fs = require('node:fs');
    fs.writeFileSync(mapPath, JSON.stringify(mapData));
  }

  load(filePath: string): void {
    const faiss = require('faiss-node');
    const fs = require('node:fs');

    // Load FAISS index
    this.index = faiss.Index.read(filePath);

    // Load ID maps and node-shard mapping
    const mapPath = filePath.replace(/\.faiss$/, '_ids.json');
    if (fs.existsSync(mapPath)) {
      const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      this.idMap = new Map(mapData.idMap);
      this.reverseMap = new Map(
        Array.from(this.idMap.entries()).map(([k, v]: [number, string]) => [v, k])
      );
      this.nodeToShards = new Map(mapData.nodeToShards);
      this.nextId = mapData.nextId;
    }
  }
}
