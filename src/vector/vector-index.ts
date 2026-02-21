/**
 * VectorIndex Interface
 *
 * Defines the contract for vector indexes (FAISS, HNSW, etc.)
 */

/**
 * Result of a vector search.
 */
export interface VectorSearchResult {
  /** ID of the matched item (leafId or nodeId) */
  id: string;
  /** Similarity score (cosine similarity for normalized vectors, 0-1, higher = better) */
  score: number;
}

/**
 * Interface for vector indexes.
 */
export interface VectorIndex {
  /**
   * Add vectors to the index.
   * @param ids - IDs for each vector (leafId or nodeId)
   * @param vectors - Normalized embedding vectors
   */
  add(ids: string[], vectors: Float32Array[]): void;

  /**
   * Search for nearest neighbors.
   * @param query - Query vector (normalized)
   * @param topK - Number of results to return
   * @returns Sorted results (highest score first)
   */
  search(query: Float32Array, topK: number): VectorSearchResult[];

  /**
   * Train the index (required for IVFPQ before add).
   * @param trainingVectors - Representative sample of vectors
   */
  train(trainingVectors: Float32Array[]): void;

  /**
   * Serialize index to a file path.
   */
  save(filePath: string): void;

  /**
   * Load index from a file path.
   */
  load(filePath: string): void;

  /**
   * Number of vectors in the index.
   */
  readonly size: number;
}

