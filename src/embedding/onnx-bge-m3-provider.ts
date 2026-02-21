/**
 * OnnxBgeM3Provider
 *
 * Embedding provider using bge-m3 model via ONNX Runtime.
 * Produces 1024-dimensional normalized embeddings.
 */

import type { EmbeddingProvider, EmbeddingResult } from './embedding-provider.js';
import { l2Normalize } from './embedding-provider.js';
import { BgeM3Tokenizer, approximateTokenCount } from './tokenizer.js';

export interface OnnxBgeM3Config {
  modelPath: string;
  tokenizerPath: string;
  maxSequenceLength: number;
  numThreads: number;
}

export const DEFAULT_BGE_M3_CONFIG: OnnxBgeM3Config = {
  modelPath: './models/bge-m3/model.onnx',
  tokenizerPath: './models/bge-m3/tokenizer.json',
  maxSequenceLength: 8192,
  numThreads: 4,
};

/**
 * bge-m3 embedding provider using ONNX Runtime.
 */
export class OnnxBgeM3Provider implements EmbeddingProvider {
  readonly modelName = 'bge-m3-int8';
  readonly dimension = 1024;

  private session: any = null; // ort.InferenceSession
  private tokenizer: BgeM3Tokenizer;
  private initialized = false;

  constructor(private config: OnnxBgeM3Config = DEFAULT_BGE_M3_CONFIG) {
    this.tokenizer = new BgeM3Tokenizer();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid loading ONNX if not needed
      const ort = await import('onnxruntime-node');

      // Create session with optimizations
      // Note: onnxruntime-node uses 'cpu' not 'CPUExecutionProvider'
      const sessionOptions: any = {
        executionProviders: ['cpu'],
        interOpNumThreads: this.config.numThreads,
        intraOpNumThreads: this.config.numThreads,
        graphOptimizationLevel: 'all',
      };

      this.session = await ort.InferenceSession.create(this.config.modelPath, sessionOptions);

      // Load tokenizer
      await this.tokenizer.load(this.config.tokenizerPath);

      // Mark as initialized before warmup (embed() checks this)
      this.initialized = true;

      // Warm up with dummy inference
      await this.embed('warmup');
    } catch (error) {
      this.initialized = false;
      throw new Error(`Failed to initialize OnnxBgeM3Provider: ${error}`);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.session) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    const ort = await import('onnxruntime-node');

    // Tokenize
    const encoded = this.tokenizer.encode(text, this.config.maxSequenceLength);

    // Create input tensors
    const inputIds = new ort.Tensor('int64', encoded.inputIds, [1, encoded.inputIds.length]);
    const attentionMask = new ort.Tensor('int64', encoded.attentionMask, [1, encoded.attentionMask.length]);
    const tokenTypeIds = new ort.Tensor('int64', encoded.tokenTypeIds, [1, encoded.tokenTypeIds.length]);

    // Run inference
    // Note: BGE-M3 model only needs input_ids and attention_mask
    const feeds = {
      input_ids: inputIds,
      attention_mask: attentionMask,
    };

    const results = await this.session.run(feeds);

    // BGE-M3 outputs: 'sentence_embedding' (pooled) and 'token_embeddings' (per-token)
    // Use sentence_embedding for the final embedding
    const sentenceEmbedding = results['sentence_embedding'];
    const embedding = new Float32Array(this.dimension);

    for (let i = 0; i < this.dimension; i++) {
      embedding[i] = sentenceEmbedding.data[i];
    }

    // L2 normalize
    const normalized = l2Normalize(embedding);

    return {
      vector: normalized,
      tokenCount: encoded.tokenCount,
    };
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // For now, process sequentially within batch
      // TODO: Implement true batch inference with padding
      for (const text of batch) {
        results.push(await this.embed(text));
      }
    }

    return results;
  }

  countTokens(text: string): number {
    if (this.tokenizer.isLoaded) {
      return this.tokenizer.countTokens(text);
    }
    return approximateTokenCount(text);
  }

  async dispose(): Promise<void> {
    if (this.session) {
      // ONNX session doesn't have explicit dispose, but we can null it
      this.session = null;
    }
    this.initialized = false;
  }
}

