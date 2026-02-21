/**
 * MSRL Configuration Schema
 *
 * Defines the configuration structure for MsrlEngine with Zod validation.
 * All settings have sensible defaults; only vaultRoot is required.
 */

import { z } from 'zod';
import * as os from 'node:os';
import * as path from 'node:path';

// =============================================================================
// Default Paths
// =============================================================================

const DEFAULT_MODEL_DIR = path.join(os.homedir(), '.msrl', 'models', 'bge-m3');

// =============================================================================
// Configuration Schema
// =============================================================================

export const msrlConfigSchema = z.object({
  // --- Required ---
  /** Absolute path to the Obsidian vault root directory */
  vaultRoot: z.string().min(1),

  // --- Snapshot Storage ---
  /** Directory for snapshot data (default: {vaultRoot}/.msrl) */
  snapshotDir: z.string().optional(),

  // --- Embedding ---
  embedding: z
    .object({
      /** Path to ONNX model file */
      modelPath: z.string().default(path.join(DEFAULT_MODEL_DIR, 'model.onnx')),
      /** Path to tokenizer.json */
      tokenizerPath: z.string().default(path.join(DEFAULT_MODEL_DIR, 'tokenizer.json')),
      /** Maximum sequence length for tokenizer */
      maxSequenceLength: z.number().default(8192),
      /** Number of ONNX inference threads */
      numThreads: z.number().min(1).max(32).default(4),
      /** Batch size for embedding generation */
      batchSize: z.number().min(1).max(128).default(32),
    })
    .default({}),

  // --- Chunking ---
  chunking: z
    .object({
      /** Minimum target tokens per chunk */
      targetMinTokens: z.number().default(600),
      /** Maximum target tokens per chunk */
      targetMaxTokens: z.number().default(1000),
      /** Hard maximum tokens (never exceed) */
      hardMaxTokens: z.number().default(1200),
      /** Minimum tokens to avoid merging small chunks */
      minPreferredTokens: z.number().default(200),
      /** Overlap tokens between consecutive chunks */
      overlapTokens: z.number().default(100),
    })
    .default({}),

  // --- Sharding ---
  sharding: z
    .object({
      /** Number of FAISS shards (must match NUM_SHARDS constant) */
      shardCount: z.number().default(128),
      /** Maximum shards to search per query (for outline routing) */
      maxShardsPerQuery: z.number().default(16),
    })
    .default({}),

  // --- Retrieval ---
  retrieval: z
    .object({
      /** Weight for vector similarity in hybrid score */
      vectorWeight: z.number().min(0).max(1).default(0.75),
      /** Weight for BM25 in hybrid score */
      bm25Weight: z.number().min(0).max(1).default(0.25),
      /** Default number of results to return */
      defaultTopK: z.number().default(8),
      /** Maximum number of results to return */
      maxTopK: z.number().default(50),
      /** Default maximum excerpt length in characters */
      defaultMaxExcerptChars: z.number().default(4000),
      /** Maximum excerpt length in characters */
      maxMaxExcerptChars: z.number().default(20000),
      /** Gap threshold for merging adjacent spans (chars) */
      spanMergeGapThreshold: z.number().default(200),
    })
    .default({}),

  // --- FAISS ---
  faiss: z
    .object({
      /**
       * Maximum number of shards to keep in LRU cache.
       * Note: faiss-node does NOT support memory mapping (IO_FLAG_MMAP),
       * so we use an LRU cache instead.
       */
      maxCachedShards: z.number().default(16),
      /** Threshold for switching from IndexFlatIP to IndexIVFPQ */
      ivfpqThreshold: z.number().default(1000),
      /** Number of probes for IVFPQ search */
      nprobe: z.number().default(16),
    })
    .default({}),

  // --- File Watcher ---
  watcher: z
    .object({
      /** Enable file watching on startup */
      enabled: z.boolean().default(true),
      /** Debounce delay in milliseconds */
      debounceMs: z.number().min(100).max(30000).default(2000),
    })
    .default({}),

  // --- Logging ---
  /** Log level */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// =============================================================================
// Type Export
// =============================================================================

/** Fully resolved configuration with all defaults applied */
export type MsrlConfig = z.infer<typeof msrlConfigSchema>;

/** Input configuration - only vaultRoot is required, all other fields are optional */
export type MsrlConfigInput = z.input<typeof msrlConfigSchema>;

// =============================================================================
// Config Helpers
// =============================================================================

/**
 * Parse and validate configuration with defaults applied.
 */
export function parseConfig(input: unknown): MsrlConfig {
  return msrlConfigSchema.parse(input);
}

/**
 * Get the snapshot directory for a given config.
 * Defaults to {vaultRoot}/.msrl if not explicitly set.
 */
export function getSnapshotDir(config: MsrlConfig): string {
  return config.snapshotDir ?? path.join(config.vaultRoot, '.msrl');
}

/**
 * Default chunker configuration extracted from config.
 */
export interface ChunkerConfig {
  targetMinTokens: number;
  targetMaxTokens: number;
  hardMaxTokens: number;
  minPreferredTokens: number;
  overlapTokens: number;
}

export function getChunkerConfig(config: MsrlConfig): ChunkerConfig {
  return config.chunking;
}

