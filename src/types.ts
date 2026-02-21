/**
 * MSRL Core Types
 *
 * This file contains all shared types for the MSRL library.
 * Types are organized by domain: Parser, Store, Retrieval, Engine.
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Heading path separator: " → " (Unicode U+2192)
 *
 * We use Unicode arrow instead of " > " because:
 * - Unambiguous: " → " won't appear in real heading titles
 * - Human-readable: Clear visual hierarchy
 * - No escaping needed: Titles containing ">" work correctly
 *
 * Example: "My Document → A > B Comparison → Details"
 * (The "A > B Comparison" heading title is preserved without ambiguity)
 */
export const HEADING_PATH_SEPARATOR = ' → ';

/**
 * Number of shards for FAISS index partitioning.
 * Documents are assigned to shards via: hash(docUri) % NUM_SHARDS
 */
export const NUM_SHARDS = 128;

// =============================================================================
// Parser Types
// =============================================================================

/**
 * A node in the heading tree representing a Markdown heading.
 */
export interface HeadingNode {
  /** Deterministic ID: hash(docUri + headingPath) */
  nodeId: string;
  /** Heading level: 1-6 (0 for virtual root) */
  level: number;
  /** Raw heading text (without # prefix) */
  title: string;
  /** Full path: "Root → Section → Subsection" */
  headingPath: string;
  /** Start offset in normalized text (inclusive) */
  startChar: number;
  /** End offset in normalized text (exclusive) */
  endChar: number;
  /** Child heading nodes */
  children: HeadingNode[];
}

/**
 * The complete heading tree for a document.
 */
export interface HeadingTree {
  /** Vault-relative document path */
  docUri: string;
  /** Virtual root node (level 0) containing all top-level headings */
  root: HeadingNode;
}

/**
 * A text chunk (leaf) produced by the chunker.
 */
export interface Chunk {
  /** Deterministic ID: hash(docUri + startChar + endChar) */
  leafId: string;
  /** Vault-relative document path */
  docUri: string;
  /** Parent heading node ID */
  nodeId: string;
  /** Full heading path for this chunk */
  headingPath: string;
  /** Start offset in normalized text (inclusive) */
  startChar: number;
  /** End offset in normalized text (exclusive) */
  endChar: number;
  /** Exact text slice: normalizedText[startChar:endChar] */
  text: string;
  /** SHA256 hash of text content */
  textHash: string;
  /** Shard assignment: hash(docUri) % NUM_SHARDS */
  shardId: number;
  /** Approximate token count for validation */
  tokenCount: number;
}

/**
 * A fenced code block region in the document.
 */
export interface FencedRegion {
  /** Start offset of opening fence (inclusive) */
  startChar: number;
  /** End offset of closing fence (exclusive) */
  endChar: number;
  /** Language tag if present (e.g., "typescript") */
  language: string | null;
}

// =============================================================================
// Store Types (Database Rows)
// =============================================================================

/**
 * Document row in the metadata store.
 */
export interface DocRow {
  /** Auto-increment primary key */
  docId: number;
  /** Vault-relative path (unique) */
  docUri: string;
  /** File modification time in milliseconds */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** SHA256 hash of normalized content */
  hash: string;
}

/**
 * Node (heading) row in the metadata store.
 */
export interface NodeRow {
  /** Deterministic node ID */
  nodeId: string;
  /** Foreign key to docs table */
  docId: number;
  /** Heading level (0-6) */
  level: number;
  /** Full heading path */
  headingPath: string;
  /** Start offset in normalized text */
  startChar: number;
  /** End offset in normalized text */
  endChar: number;
  /** Shard assignment */
  shardId: number;
}

/**
 * Leaf (chunk) row in the metadata store.
 */
export interface LeafRow {
  /** Deterministic leaf ID */
  leafId: string;
  /** Foreign key to docs table */
  docId: number;
  /** Foreign key to nodes table */
  nodeId: string;
  /** Start offset in normalized text */
  startChar: number;
  /** End offset in normalized text */
  endChar: number;
  /** SHA256 hash of text content */
  textHash: string;
  /** Shard assignment */
  shardId: number;
}

/**
 * Leaf row with optional embedding data.
 */
export interface LeafRowWithEmbedding extends LeafRow {
  /** Embedding vector (null if not yet computed) */
  embedding: Float32Array | null;
}

// =============================================================================
// Retrieval Types
// =============================================================================

/**
 * A single search result from hybrid search.
 * All fields are required (no optional fields in v1).
 */
export interface SearchResult {
  // --- Provenance ---
  /** Vault-relative document path */
  docUri: string;
  /** Full heading path: "Root → Section → Subsection" */
  headingPath: string;

  // --- Span location ---
  /** Start offset in normalized text (inclusive) */
  startChar: number;
  /** End offset in normalized text (exclusive, may be merged span) */
  endChar: number;

  // --- Content ---
  /** Text slice, may be truncated to maxExcerptChars */
  excerpt: string;
  /** True if excerpt was truncated */
  excerptTruncated: boolean;

  // --- Scores ---
  /** Final hybrid score (0-1, higher = better) */
  score: number;
  /** Cosine similarity component (0-1) */
  vectorScore: number;
  /** BM25 component (0-1, normalized) */
  bm25Score: number;
}

/**
 * Query result wrapper with metadata.
 */
export interface QueryResult {
  /** Search results ordered by score (descending) */
  results: SearchResult[];
  /** Query metadata */
  meta: {
    /** Total query time in milliseconds */
    tookMs: number;
    /** Shard IDs searched (only if includeShardsSearched=true) */
    shardsSearched?: number[];
  };
}

/**
 * BM25 search result from FTS5.
 */
export interface Bm25Result {
  /** Leaf ID */
  leafId: string;
  /** Vault-relative document path */
  docUri: string;
  /** Full heading path */
  headingPath: string;
  /** Raw FTS5 rank (negative, lower = more relevant) */
  bm25Score: number;
  /** Normalized score (0-1 range) */
  normalizedScore: number;
}

/**
 * Vector search result from FAISS.
 */
export interface VectorSearchResult {
  /** Leaf ID */
  leafId: string;
  /** Cosine similarity score (0-1) */
  score: number;
}

// =============================================================================
// Engine Types
// =============================================================================

/**
 * Index status returned by MsrlEngine.getStatus().
 */
export interface IndexStatus {
  /** Current state */
  state: 'ready' | 'building' | 'error';
  /** Active snapshot ID (null if no snapshot loaded) */
  snapshotId: string | null;
  /** Snapshot creation timestamp (ISO 8601) */
  snapshotTimestamp: string | null;
  /** Index statistics */
  stats: {
    /** Number of indexed documents */
    docs: number;
    /** Number of heading nodes */
    nodes: number;
    /** Number of leaf chunks */
    leaves: number;
    /** Number of active shards */
    shards: number;
  };
  /** File watcher configuration */
  watcher: {
    /** Whether watcher is enabled */
    enabled: boolean;
    /** Debounce delay in milliseconds */
    debounceMs: number;
  };
  /** Error message (present if state === 'error') */
  error?: string;
}

/**
 * Reindex request parameters.
 */
export interface ReindexParams {
  /** Scope of reindex operation */
  scope: 'changed' | 'full' | 'prefix';
  /** Prefix filter (required if scope === 'prefix') */
  prefix?: string;
  /** Whether to wait for completion */
  wait?: boolean;
}

/**
 * Reindex result.
 */
export interface ReindexResult {
  /** Whether reindex completed (false if wait=false and still building) */
  completed: boolean;
  /** New snapshot ID (if completed) */
  snapshotId?: string;
  /** Build statistics (if completed) */
  stats?: {
    /** Documents added */
    docsAdded: number;
    /** Documents modified */
    docsModified: number;
    /** Documents deleted */
    docsDeleted: number;
    /** Total build time in milliseconds */
    buildTimeMs: number;
  };
}

/**
 * Watch configuration parameters.
 */
export interface WatchParams {
  /** Enable or disable file watching */
  enabled: boolean;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
}

/**
 * Watch result.
 */
export interface WatchResult {
  /** Current enabled state */
  enabled: boolean;
  /** Current debounce delay */
  debounceMs: number;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for MsrlError.
 */
export type MsrlErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'NOT_INDEXED'
  | 'INDEX_BUSY'
  | 'INDEX_CORRUPT'
  | 'IO_ERROR'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'INTERNAL';

/**
 * Typed error class for MSRL operations.
 *
 * Error details structure by code:
 * - INVALID_ARGUMENT: { field, value, reason, validOptions? }
 * - NOT_FOUND: { docUri?, headingPath? }
 * - NOT_INDEXED: {} (no details needed)
 * - INDEX_BUSY: { currentBuildStartedAt }
 * - INDEX_CORRUPT: { snapshotId, reason, missingFiles? }
 * - IO_ERROR: { path, operation, errno? }
 * - MODEL_DOWNLOAD_FAILED: { url, reason }
 * - INTERNAL: { originalError? }
 */
export class MsrlError extends Error {
  constructor(
    public readonly code: MsrlErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MsrlError';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, MsrlError.prototype);
  }
}
