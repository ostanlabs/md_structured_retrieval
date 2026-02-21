/**
 * MSRL - Markdown Structured Retrieval Library
 *
 * Public API exports for the MSRL library.
 */

// =============================================================================
// Configuration
// =============================================================================

export { msrlConfigSchema, parseConfig, getSnapshotDir, getChunkerConfig } from './config.js';
export type { MsrlConfig, MsrlConfigInput, ChunkerConfig } from './config.js';

// =============================================================================
// Types
// =============================================================================

// Constants
export { HEADING_PATH_SEPARATOR, NUM_SHARDS } from './types.js';

// Parser types
export type {
  HeadingNode,
  HeadingTree,
  Chunk,
  FencedRegion,
} from './types.js';

// Store types
export type {
  DocRow,
  NodeRow,
  LeafRow,
  LeafRowWithEmbedding,
} from './types.js';

// Retrieval types
export type {
  SearchResult,
  QueryResult,
  Bm25Result,
  VectorSearchResult,
} from './types.js';

// Engine types
export type {
  IndexStatus,
  ReindexParams,
  ReindexResult,
  WatchParams,
  WatchResult,
} from './types.js';

// Error types
export { MsrlError } from './types.js';
export type { MsrlErrorCode } from './types.js';

// =============================================================================
// Engine
// =============================================================================

export { MsrlEngine } from './engine.js';
export type { EngineQueryParams, EngineReindexParams, EngineWatchParams } from './engine.js';

// =============================================================================
// Error Utilities
// =============================================================================

export {
  isMsrlError,
  invalidArgument,
  notFound,
  notIndexed,
  indexBusy,
  indexCorrupt,
  ioError,
  modelDownloadFailed,
  internalError,
} from './errors.js';

// =============================================================================
// Logger
// =============================================================================

export { createLogger, setGlobalLogLevel, getGlobalLogLevel } from './logger.js';
export type { LogLevel, Logger } from './logger.js';
