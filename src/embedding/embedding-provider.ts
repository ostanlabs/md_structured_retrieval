/**
 * EmbeddingProvider Interface
 *
 * Defines the contract for embedding providers.
 * Implementations can use different models (bge-m3, OpenAI, etc.)
 */

/**
 * Result of embedding a text.
 */
export interface EmbeddingResult {
  /** Normalized embedding vector */
  vector: Float32Array;
  /** Number of tokens in the input text */
  tokenCount: number;
}

/**
 * Interface for embedding providers.
 */
export interface EmbeddingProvider {
  /** Model name/identifier */
  readonly modelName: string;
  /** Embedding dimension */
  readonly dimension: number;

  /**
   * Initialize the provider (load model, warm up).
   * Must be called once before embed().
   */
  initialize(): Promise<void>;

  /**
   * Embed a single text string.
   * Returns normalized vector.
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Embed a batch of texts.
   * Implementations should optimize for batch processing.
   */
  embedBatch(texts: string[], batchSize?: number): Promise<EmbeddingResult[]>;

  /**
   * Count tokens in text without embedding.
   */
  countTokens(text: string): number;

  /**
   * Release resources.
   */
  dispose(): Promise<void>;
}

/**
 * L2 normalize a vector to unit length.
 * After normalization, cosine similarity = dot product.
 */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i]! ** 2;
  }

  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return vector; // Zero vector stays zero
  }

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i]! / norm;
  }

  return normalized;
}

/**
 * Compute cosine similarity between two normalized vectors.
 * For normalized vectors, this is just the dot product.
 */
export function cosineSimilarity(v1: Float32Array, v2: Float32Array): number {
  if (v1.length !== v2.length) {
    throw new Error(`Vector dimension mismatch: ${v1.length} vs ${v2.length}`);
  }

  let dotProduct = 0;
  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i]! * v2[i]!;
  }

  return dotProduct;
}

