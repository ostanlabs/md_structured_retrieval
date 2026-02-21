# MSRL Implementation Specification v6 — Full Blueprint

**Status:** Implementation-ready
**Target repo:** `ostanlabs/obsidian_mcp` (existing TypeScript MCP server)
**Date:** 2026-02-20

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Repo Integration & Directory Layout](#2-repo-integration--directory-layout)
3. [Dependency Manifest](#3-dependency-manifest)
4. [Module Architecture](#4-module-architecture)
5. [Phase 1 — Markdown Parser & Chunker](#5-phase-1--markdown-parser--chunker)
6. [Phase 2 — Embedding Provider & Vector Index](#6-phase-2--embedding-provider--vector-index)
7. [Phase 3 — Metadata Store & BM25](#7-phase-3--metadata-store--bm25)
8. [Phase 4 — Hybrid Retrieval Pipeline](#8-phase-4--hybrid-retrieval-pipeline)
9. [Phase 5 — Snapshot Lifecycle & File Watcher](#9-phase-5--snapshot-lifecycle--file-watcher)
10. [Phase 6 — MCP Tool Integration](#10-phase-6--mcp-tool-integration)
11. [Phase 7 — Optional doc.* Tools](#11-phase-7--optional-doc-tools)
12. [Cross-Cutting Concerns](#12-cross-cutting-concerns)
13. [Test Strategy](#13-test-strategy)
14. [Performance Budgets & Benchmarks](#14-performance-budgets--benchmarks)
15. [Configuration Schema](#15-configuration-schema)
16. [Migration & Rollout Plan](#16-migration--rollout-plan)

---

## 1. Executive Summary

MSRL (MCP Structured Retrieval Library) is a Markdown-native, hierarchical, hybrid-search retrieval engine that runs fully in-process inside the existing `obsidian_mcp` TypeScript MCP server. It indexes a single Obsidian vault, builds immutable FAISS+SQLite snapshots, and exposes search via MCP tools.

### Key technology choices (locked)

| Component | Choice | Package |
|-----------|--------|---------|
| Language | TypeScript (ESM, NodeNext) | — |
| Embeddings | BAAI/bge-m3 via ONNX | `onnxruntime-node` |
| Vector ANN | FAISS IVFPQ (leaf shards) + HNSW (outline) | `faiss-node` |
| Metadata + FTS | SQLite WAL + FTS5 | `better-sqlite3` |
| File watcher | chokidar | `chokidar` |
| Validation | Zod (already in repo) | `zod` |
| Testing | Vitest (already in repo) | `vitest` |

---

## 2. Repo Integration & Directory Layout

MSRL lives in the `md_retriever/` directory, which is a **git submodule** of the parent `obsidian_mcp` repo. This allows MSRL to be:
- Developed and versioned independently
- Reused in other projects (CLI tools, other MCP servers)
- Published as a standalone npm package

### 2.1 Directory tree

```
obsidian_mcp/                                  # Parent MCP server repo
├── md_retriever/                              # Git submodule (this repo)
│   ├── package.json                           # npm package (name: @ostanlabs/md-retriever)
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── README.md                              # Usage documentation
│   ├── msrl-implementation-spec-v6.md         # This spec
│   │
│   └── src/
│       ├── index.ts                           # Public API barrel export
│       ├── types.ts                           # All shared types & Zod schemas
│       ├── config.ts                          # MsrlConfig schema + defaults
│       │
│       ├── parser/
│       │   ├── markdown-parser.ts
│       │   ├── heading-tree.ts
│       │   ├── chunker.ts
│       │   ├── fence-detector.ts
│       │   └── __tests__/
│       │       ├── markdown-parser.test.ts
│       │       ├── heading-tree.test.ts
│       │       ├── chunker.test.ts
│       │       └── fixtures/
│       │
│       ├── embedding/
│       │   ├── embedding-provider.ts          # Interface
│       │   ├── onnx-bge-m3-provider.ts        # Default impl
│       │   ├── model-downloader.ts            # HuggingFace model download
│       │   ├── tokenizer.ts                   # bge-m3 tokenizer wrapper
│       │   └── __tests__/
│       │
│       ├── vector/
│       │   ├── vector-index.ts                # Interface
│       │   ├── faiss-shard-index.ts           # IVFPQ leaf shard impl
│       │   ├── hnsw-outline-index.ts          # HNSW outline routing impl
│       │   ├── shard-router.ts                # hash(doc_uri) % 128
│       │   ├── node-embedding.ts              # MMR representative selection
│       │   └── __tests__/
│       │
│       ├── store/
│       │   ├── metadata-store.ts              # SQLite wrapper
│       │   ├── schema.sql                     # DDL for docs, nodes, leaves, leaves_fts
│       │   ├── bm25-index.ts                  # FTS5 query/scoring wrapper
│       │   └── __tests__/
│       │
│       ├── retrieval/
│       │   ├── retrieval-pipeline.ts          # Full hybrid pipeline orchestrator
│       │   ├── hybrid-scorer.ts               # 0.75*vec + 0.25*bm25 + tie-break
│       │   ├── span-merger.ts                 # Merge adjacent/overlapping spans
│       │   └── __tests__/
│       │
│       ├── lifecycle/
│       │   ├── snapshot-manager.ts            # Build, validate, activate, rollback
│       │   ├── snapshot-builder.ts            # Orchestrates full/incremental build
│       │   ├── file-scanner.ts                # Vault scanning + change detection
│       │   ├── file-watcher.ts                # chokidar wrapper + debounce
│       │   └── __tests__/
│       │
│       ├── engine.ts                          # MsrlEngine — top-level orchestrator
│       │
│       └── doc/                               # Optional structured-write (Phase 7)
│           ├── doc-validator.ts
│           ├── doc-writer.ts
│           └── __tests__/
│
├── src/
│   ├── tools/
│   │   ├── msrl-tools.ts                      # MCP tool definitions + handlers
│   │   └── index.ts                           # Updated: exports msrlToolDefinitions
│   └── index.ts                               # Updated: registers MSRL tools
│
└── package.json                               # References md_retriever as dependency
```

**Model files** are downloaded on first run to a configurable location (default: `~/.msrl/models/bge-m3/`).

**Snapshot data** is stored in the vault's `.msrl/` directory (gitignored by Obsidian).

### 2.2 Package configuration

**`md_retriever/package.json`:**

```jsonc
{
  "name": "@ostanlabs/md-retriever",
  "version": "0.1.0",
  "description": "Markdown-native hybrid search retrieval engine for Obsidian vaults",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "download-models": "tsx src/embedding/model-downloader.ts"
  },
  "dependencies": {
    "onnxruntime-node": "^1.17.0",
    "faiss-node": "^0.5.1",
    "better-sqlite3": "^11.7.0",
    "chokidar": "^4.0.0",
    "zod": "^3.22.4",
    "@xenova/transformers": "^2.17.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "vitest": "^2.0.0",
    "typescript": "^5.5.0",
    "tsx": "^4.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ostanlabs/md_retriever.git"
  },
  "keywords": ["markdown", "search", "retrieval", "obsidian", "vector", "embeddings", "faiss"],
  "license": "MIT"
}
```

**`md_retriever/tsconfig.json`:**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

**Parent repo integration (`obsidian_mcp/package.json`):**

```jsonc
{
  "dependencies": {
    "@ostanlabs/md-retriever": "file:./md_retriever",
    // ... other deps
  }
}
```

---

## 3. Dependency Manifest

| Package | Version | Purpose | Size impact |
|---------|---------|---------|-------------|
| `onnxruntime-node` | ^1.17.0 | ONNX inference for bge-m3 embeddings | ~50MB native binary |
| `faiss-node` | ^0.5.1 | FAISS IVFPQ + HNSW vector indexes | ~15MB native binary |
| `better-sqlite3` | ^11.7.0 | SQLite3 with FTS5, WAL mode | ~5MB native binary |
| `chokidar` | ^4.0.0 | Cross-platform file watching | ~200KB |
| `zod` | ^3.22.4 | Schema validation (already in repo) | 0 (shared) |

### Model files (not npm — downloaded at first run or bundled)

| File | Size | Source |
|------|------|--------|
| `bge-m3/model.onnx` | ~600MB (quantized INT8) | HuggingFace BAAI/bge-m3 ONNX export |
| `bge-m3/tokenizer.json` | ~15MB | HuggingFace BAAI/bge-m3 |
| `bge-m3/tokenizer_config.json` | ~1KB | HuggingFace BAAI/bge-m3 |

**Decision:** Use quantized INT8 model (~600MB, ~5-10% quality loss vs FP32). Acceptable for target hardware (CPU-only, 32GB RAM).

### Model distribution strategy

**v1 approach: Download on first run**

```typescript
// packages/msrl/src/embedding/model-downloader.ts

const MODEL_MANIFEST = {
  'bge-m3-int8': {
    files: [
      { name: 'model.onnx', url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model_quantized.onnx', sha256: '...' },
      { name: 'tokenizer.json', url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/tokenizer.json', sha256: '...' },
      { name: 'tokenizer_config.json', url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/tokenizer_config.json', sha256: '...' },
    ],
    totalSize: 615_000_000,  // ~615MB
  },
};

export async function ensureModelDownloaded(
  modelName: string,
  targetDir: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void>;
```

**Behavior:**
1. On `MsrlEngine.create()`, check if model files exist at `config.embedding.modelPath`
2. If missing, download from HuggingFace with progress callback
3. Verify SHA256 hash after download
4. If hash mismatch, delete and re-download
5. If download fails, throw `MsrlError('MODEL_DOWNLOAD_FAILED', { url, reason })`

**Why download-on-first-run (not bundled):**
- npm package stays small (~70MB native deps only)
- Model can be updated independently of package version
- Users can provide their own model path (custom fine-tuned models)
- CI/CD can pre-download models to avoid runtime downloads

**Future option: Bundled distribution**
For enterprise/offline deployments, we may later offer:
- A separate npm package `@msrl/models-bge-m3` containing the model
- A Docker image with models pre-installed
- A CLI command `npx msrl download-models`

For v1, download-on-first-run is sufficient.

---

## 4. Module Architecture

### 4.0 Library vs MCP Server Architecture

**MSRL is a library**, not a standalone server. The architecture is:

```
┌─────────────────────────────────────────────────────────────┐
│                    obsidian_mcp (MCP Server)                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  src/tools/msrl-tools.ts                            │   │
│  │  - Registers MCP tools: msrl.query, msrl.status,    │   │
│  │    msrl.reindex, msrl.watch, doc.*                  │   │
│  │  - Maps snake_case MCP params → camelCase engine    │   │
│  │  - Handles MCP protocol (JSON-RPC)                  │   │
│  └───────────────────────┬─────────────────────────────┘   │
│                          │ imports                          │
│  ┌───────────────────────▼─────────────────────────────┐   │
│  │  packages/msrl/ (@msrl/core)                        │   │
│  │  - Pure TypeScript library                          │   │
│  │  - No MCP knowledge                                 │   │
│  │  - Exports: MsrlEngine, types, config schema        │   │
│  │  - Could be extracted to separate repo later        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Tool naming convention:**
- `msrl.*` prefix for core retrieval tools (query, status, reindex, watch)
- `doc.*` prefix for structured document manipulation tools (Phase 7)
- All tools are registered in the MCP server, not in the MSRL library

**Why this separation?**
- MSRL library is testable without MCP infrastructure
- Library can be reused in non-MCP contexts (CLI, other servers)
- Clear boundary: library handles indexing/search, MCP layer handles protocol

### 4.1 Dependency graph (build order)

```
types.ts, config.ts          ← no internal deps
        │
        ▼
parser/*                     ← depends on types
        │
        ▼
embedding/*                  ← depends on types, config
        │
        ▼
vector/*                     ← depends on types, embedding (for dims)
store/*                      ← depends on types
        │
        ▼
retrieval/*                  ← depends on vector, store, embedding, parser
        │
        ▼
lifecycle/*                  ← depends on all above
        │
        ▼
engine.ts                    ← top-level orchestrator
        │
        ▼
src/tools/msrl-tools.ts      ← MCP integration (in main src/)
```

### 4.2 Public API surface (`packages/msrl/src/index.ts`)

```typescript
// The only file that matters for MCP integration
export { MsrlEngine } from './engine.js';
export { MsrlConfig, msrlConfigSchema } from './config.js';

// Types for tool response construction
export type {
  SearchResult,          // includes excerptTruncated flag
  IndexStatus,
  ReindexRequest,
  ReindexResult,
  WatchConfig,
  MsrlError,
} from './types.js';
```

### 4.3 MsrlEngine — top-level orchestrator

```typescript
// packages/msrl/src/engine.ts

import type { MsrlConfig } from './config.js';
import type { SearchResult, IndexStatus, ReindexResult } from './types.js';

export class MsrlEngine {
  // --- Lifecycle ---
  static async create(config: MsrlConfig): Promise<MsrlEngine>;
  async shutdown(): Promise<void>;

  // --- Query ---
  /**
   * Hybrid search.
   *
   * MCP tool layer uses snake_case (query, top_k, max_excerpt_chars, etc.).
   * The tool handler in src/tools/msrl-tools.ts maps snake_case → camelCase
   * before calling this method. This engine API uses camelCase throughout.
   *
   * Mapping reference:
   *   top_k              → topK
   *   max_excerpt_chars   → maxExcerptChars
   *   doc_uri_prefix      → docUriPrefix
   *   doc_uris            → docUris
   *   heading_path_contains → headingPathContains
   *   include_scores      → includeScores
   *   include_shards_searched → includeShardsSearched
   */
  async query(params: {
    query: string;
    topK?: number;
    maxExcerptChars?: number;
    filters?: {
      docUriPrefix?: string;
      docUris?: string[];
      headingPathContains?: string;
    };
    debug?: {
      includeScores?: boolean;
      includeShardsSearched?: boolean;
    };
  }): Promise<{ results: SearchResult[]; meta: { tookMs: number; shardsSearched?: number[] } }>;

  // --- Index management ---
  async reindex(params: {
    scope: 'changed' | 'full' | 'prefix';
    docUriPrefix?: string;
    wait?: boolean;
  }): Promise<ReindexResult>;

  // --- Status ---
  getStatus(): IndexStatus;

  // --- Watcher ---
  async setWatch(params: { enabled: boolean; debounceMs?: number }): Promise<{ enabled: boolean; debounceMs: number }>;

  // --- Internal (not exported from index.ts) ---
  // private snapshotManager: SnapshotManager;
  // private retrievalPipeline: RetrievalPipeline;
  // private fileWatcher: FileWatcher;
  // private embeddingProvider: EmbeddingProvider;
}
```

---

## 5. Phase 1 — Markdown Parser & Chunker

**Goal:** Parse Markdown files into a heading tree and produce deterministic chunks.

**Milestone:** Given any `.md` file, produce a `HeadingTree` and a list of `Chunk` objects with stable `start_char`/`end_char` offsets. All chunks respect fence integrity and size bounds.

### 5.1 Types

```typescript
// packages/msrl/src/types.ts (Phase 1 subset)

export interface HeadingNode {
  nodeId: string;               // deterministic: hash(docUri + headingPath)
  level: number;                // 1-6
  title: string;                // raw heading text
  headingPath: string;          // "Root → Section → Subsection" (Unicode arrow U+2192)
  startChar: number;            // inclusive
  endChar: number;              // exclusive
  children: HeadingNode[];
}

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

export interface HeadingTree {
  docUri: string;
  root: HeadingNode;            // virtual root (level 0)
}

export interface Chunk {
  leafId: string;               // deterministic: hash(docUri + startChar + endChar)
  docUri: string;
  nodeId: string;               // parent heading node
  headingPath: string;
  startChar: number;            // inclusive, into normalized text
  endChar: number;              // exclusive
  text: string;                 // exact slice: normalizedText[startChar:endChar]
  textHash: string;             // sha256(text)
  shardId: number;              // hash(docUri) % 128
  tokenCount: number;           // approximate, for validation
}

/**
 * Search result returned by MsrlEngine.query().
 * All fields are required (no optional fields in v1).
 */
export interface SearchResult {
  // --- Provenance ---
  docUri: string;               // vault-relative path
  headingPath: string;          // "Root → Section → Subsection"

  // --- Span location ---
  startChar: number;            // inclusive, into normalized text
  endChar: number;              // exclusive (may be merged span)

  // --- Content ---
  excerpt: string;              // text slice, may be truncated
  excerptTruncated: boolean;    // true if excerpt was truncated to maxExcerptChars

  // --- Scores ---
  score: number;                // final hybrid score (0-1, higher = better)
  vectorScore: number;          // cosine similarity component (0-1)
  bm25Score: number;            // BM25 component (0-1, normalized)
}

/**
 * Query result wrapper with metadata.
 */
export interface QueryResult {
  results: SearchResult[];
  meta: {
    tookMs: number;             // total query time in milliseconds
    shardsSearched?: number[];  // only if includeShardsSearched=true
  };
}
```

### 5.2 `MarkdownParser`

```typescript
// packages/msrl/src/parser/markdown-parser.ts

export class MarkdownParser {
  /**
   * Normalize file text for deterministic indexing.
   * - Normalize line endings to \n
   * - Strip BOM
   * - Ensure trailing newline
   * - Preserve all other content exactly
   */
  normalize(raw: string): string;

  /**
   * Parse normalized text into a heading tree.
   * Handles ATX headings only (# through ######).
   * Ignores headings inside fenced code blocks.
   */
  parseHeadings(docUri: string, normalizedText: string): HeadingTree;
}
```

**Implementation rules:**

1. Use a simple line-by-line state machine, NOT a full Markdown AST library.
2. Track fenced code block state: a line starting with ``` or ~~~ toggles fence state.
3. Inside a fence, no heading detection occurs.
4. Heading regex: `/^(#{1,6})\s+(.+)$/` on non-fenced lines.
5. Build heading path by maintaining a stack of `(level, title)` pairs. When a new heading of level N is encountered, pop all entries with level >= N, push the new one.
6. Character offsets (`startChar`, `endChar`) are byte-compatible character indices into the normalized text string. `startChar` is the index of the first character of the heading line. `endChar` is the index of the first character of the next sibling/parent heading line (or end of file).

### 5.3 `FenceDetector`

```typescript
// packages/msrl/src/parser/fence-detector.ts

export interface FencedRegion {
  startChar: number;
  endChar: number;
  language: string | null;
}

export class FenceDetector {
  /**
   * Return all fenced code block regions in the text.
   * Used by both parser (to skip headings) and chunker (to avoid splitting).
   */
  detect(normalizedText: string): FencedRegion[];

  /**
   * Check if a character offset falls inside a fenced region.
   */
  isInsideFence(offset: number, regions: FencedRegion[]): boolean;
}
```

### 5.4 `Chunker`

```typescript
// packages/msrl/src/parser/chunker.ts

export interface ChunkerConfig {
  targetMinTokens: number;    // 600
  targetMaxTokens: number;    // 1000
  hardMaxTokens: number;      // 1200
  minPreferredTokens: number; // 200
  overlapTokens: number;      // 80-150 (use 100 as default)
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  targetMinTokens: 600,
  targetMaxTokens: 1000,
  hardMaxTokens: 1200,
  minPreferredTokens: 200,
  overlapTokens: 100,
};

export class Chunker {
  constructor(
    private config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG,
    private fenceDetector: FenceDetector,
    private tokenCounter: (text: string) => number, // injected
  ) {}

  /**
   * Chunk a heading node's text content.
   * Returns chunks for the node's own text (not children).
   */
  chunkNode(
    docUri: string,
    node: HeadingNode,
    normalizedText: string,
    shardId: number,
  ): Chunk[];
}
```

**Chunking algorithm:**

1. Extract the node's own text: from `node.startChar` (after heading line) to the start of the first child, or `node.endChar` if no children.
2. Get fenced regions within this range.
3. Split text at paragraph boundaries (`\n\n`), respecting fences:
   - Never split inside a fenced code block.
   - If a fenced block exceeds `hardMaxTokens`, treat it as a single atomic chunk (exceeding the hard max is acceptable for fences).
4. Greedily accumulate paragraphs into chunks targeting `targetMinTokens` to `targetMaxTokens`.
5. When a chunk reaches `targetMaxTokens`, finalize it and start a new chunk.
6. Apply overlap using paragraph-with-word-fallback alignment (see below).
7. If the last chunk is below `minPreferredTokens`, merge it with the previous chunk (even if that exceeds `targetMaxTokens`, up to `hardMaxTokens`; if it would exceed `hardMaxTokens`, keep as separate small chunk).
8. All `startChar`/`endChar` offsets are relative to the original normalized text (not the node-local slice).

**Overlap alignment (paragraph with word fallback):**

When starting a new chunk with overlap, we want ~`overlapTokens` of shared content with the previous chunk. The overlap start position is aligned to preserve semantic coherence:

```typescript
/**
 * Find the best position to start overlap.
 * Prefers paragraph boundaries, falls back to word boundaries.
 */
function findOverlapStart(
  text: string,
  targetPos: number,      // Ideal position (overlapTokens back from chunk end)
  searchRange: number     // How far to search for paragraph break (±chars)
): number {
  const searchStart = Math.max(0, targetPos - searchRange);
  const searchEnd = Math.min(text.length, targetPos + searchRange);

  // 1. Look for paragraph break (\n\n) within search range
  const slice = text.slice(searchStart, searchEnd);
  const paragraphBreak = slice.lastIndexOf('\n\n');
  if (paragraphBreak >= 0) {
    return searchStart + paragraphBreak + 2;  // Position after \n\n
  }

  // 2. Fallback: find nearest word boundary (space)
  const wordBreak = text.lastIndexOf(' ', targetPos);
  if (wordBreak >= searchStart) {
    return wordBreak + 1;  // Position after space
  }

  // 3. Last resort: use target position as-is
  return targetPos;
}
```

**Why paragraph-with-fallback?**
- Paragraph breaks are natural semantic boundaries (best for embedding quality)
- But paragraphs may be far apart; word boundary ensures reasonable overlap
- Never splits mid-word

**Token counting:** Use a fast approximate counter. For bge-m3 (BERT-based tokenizer), approximate as `Math.ceil(text.length / 4)`. In Phase 2, replace with the actual tokenizer's count. The `tokenCounter` callback makes this swappable.

### 5.5 `ShardRouter`

```typescript
// packages/msrl/src/vector/shard-router.ts

export class ShardRouter {
  constructor(private shardCount: number = 128) {}

  /**
   * Deterministic shard assignment for a document.
   * Uses FNV-1a hash of the doc_uri string.
   */
  getShardId(docUri: string): number;
}
```

Use FNV-1a (fast, good distribution, deterministic). Do NOT use `crypto.createHash` — it's overkill and slower for this purpose.

### 5.5.1 doc_uri Format Specification

The `doc_uri` is the **canonical identifier** for a document throughout MSRL. It is used for:
- Shard assignment (`hash(docUri) % 128`)
- Node/Leaf ID generation (`hash(docUri + ...)`)
- File reading (`vaultRoot + '/' + docUri`)
- Filtering (`docUriPrefix`, `docUris`)
- Tie-breaking in search results

**Format:** Vault-relative POSIX path with `.md` extension.

```typescript
/**
 * Convert an absolute file path to a doc_uri.
 */
function toDocUri(absolutePath: string, vaultRoot: string): string {
  // 1. Make path relative to vault root
  let relative = path.relative(vaultRoot, absolutePath);

  // 2. Normalize to POSIX separators (forward slashes)
  relative = relative.split(path.sep).join('/');

  // 3. No leading slash
  if (relative.startsWith('/')) {
    relative = relative.slice(1);
  }

  return relative;
}

/**
 * Convert a doc_uri back to an absolute file path.
 */
function toAbsolutePath(docUri: string, vaultRoot: string): string {
  return path.join(vaultRoot, ...docUri.split('/'));
}
```

**Examples:**

| Absolute Path | Vault Root | doc_uri |
|---------------|------------|---------|
| `/Users/me/vault/notes/daily/2024-01-15.md` | `/Users/me/vault` | `notes/daily/2024-01-15.md` |
| `/Users/me/vault/README.md` | `/Users/me/vault` | `README.md` |
| `/Users/me/vault/Projects/AI/GPT Notes.md` | `/Users/me/vault` | `Projects/AI/GPT Notes.md` |
| `C:\Users\me\vault\notes\todo.md` | `C:\Users\me\vault` | `notes/todo.md` |

**Rules:**
1. Always use forward slashes `/` (POSIX), even on Windows
2. No leading slash
3. Includes `.md` extension
4. Preserves original case (case-sensitive)
5. Spaces and special characters are NOT encoded (kept as-is)
6. No normalization of Unicode (NFC/NFD) — use bytes as-is

### 5.6 Phase 1 tests

| Test | Description |
|------|-------------|
| `heading-tree-basic` | Parse a file with H1, H2, H3 and verify tree structure |
| `heading-tree-fenced` | Headings inside fenced blocks are NOT parsed as headings |
| `heading-tree-duplicate` | Duplicate heading titles get unique headingPath via context |
| `chunk-size-bounds` | All chunks respect min/max token bounds |
| `chunk-fence-integrity` | No chunk split inside a fenced code block |
| `chunk-atomic-fence` | Oversized fenced block becomes a single atomic chunk |
| `chunk-overlap` | Overlap tokens are within configured range |
| `chunk-offset-accuracy` | `normalizedText.slice(chunk.startChar, chunk.endChar) === chunk.text` |
| `chunk-determinism` | Same input always produces identical chunks |
| `shard-distribution` | 10K random URIs distribute roughly evenly across 128 shards |

### 5.7 Phase 1 deliverables checklist

- [ ] `types.ts` — HeadingNode, HeadingTree, Chunk types
- [ ] `config.ts` — ChunkerConfig with defaults
- [ ] `parser/markdown-parser.ts` — normalize + parseHeadings
- [ ] `parser/fence-detector.ts` — fenced region detection
- [ ] `parser/chunker.ts` — deterministic chunking
- [ ] `vector/shard-router.ts` — FNV-1a shard assignment
- [ ] All Phase 1 tests passing

---

## 6. Phase 2 — Embedding Provider & Vector Index

**Goal:** Embed text chunks using bge-m3 via ONNX, store vectors in FAISS indexes.

**Milestone:** Given a list of `Chunk` objects, produce embedding vectors and build FAISS IVFPQ shard indexes + an HNSW outline index. Persist to disk. Reload from disk.

### 6.1 Types

```typescript
// types.ts additions

export interface EmbeddingResult {
  vector: Float32Array;       // normalized, dimension = 1024 for bge-m3
  tokenCount: number;         // actual token count from tokenizer
}

export interface VectorSearchResult {
  id: string;                 // leafId or nodeId
  score: number;              // cosine similarity (0-1, higher = better)
}
```

### 6.2 `EmbeddingProvider` interface

```typescript
// packages/msrl/src/embedding/embedding-provider.ts

export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimension: number;

  /**
   * Initialize the provider (load model, warm up).
   * Must be called once before embed().
   */
  initialize(): Promise<void>;

  /**
   * Embed a single text string.
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Embed a batch of texts. Implementations should optimize for batch.
   * Default: sequential embed() calls.
   */
  embedBatch(texts: string[], batchSize?: number): Promise<EmbeddingResult[]>;

  /**
   * Get the actual token count for a text (used to replace approximate counter from Phase 1).
   */
  countTokens(text: string): number;

  /**
   * Release resources.
   */
  dispose(): Promise<void>;
}
```

### 6.3 `OnnxBgeM3Provider`

```typescript
// packages/msrl/src/embedding/onnx-bge-m3-provider.ts

import * as ort from 'onnxruntime-node';

export class OnnxBgeM3Provider implements EmbeddingProvider {
  readonly modelName = 'BAAI/bge-m3';
  readonly dimension = 1024;

  private session: ort.InferenceSession | null = null;
  private tokenizer: BgeM3Tokenizer | null = null;

  constructor(private config: {
    modelPath: string;          // path to model.onnx
    tokenizerPath: string;      // path to tokenizer.json
    maxSequenceLength: number;  // 8192 for bge-m3
    numThreads: number;         // default: 4
  }) {}

  async initialize(): Promise<void> {
    // 1. Create ONNX session with options:
    //    - executionProviders: ['CPUExecutionProvider']
    //    - interOpNumThreads: this.config.numThreads
    //    - intraOpNumThreads: this.config.numThreads
    //    - graphOptimizationLevel: 'all'
    // 2. Load tokenizer from tokenizer.json
    // 3. Warm up with a dummy inference
  }

  async embed(text: string): Promise<EmbeddingResult> {
    // 1. Tokenize text (truncate to maxSequenceLength)
    // 2. Create input tensors: input_ids, attention_mask, token_type_ids
    // 3. Run inference
    // 4. Extract [CLS] token embedding (first token of last hidden state)
    // 5. L2-normalize the vector
    // 6. Return { vector, tokenCount }
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<EmbeddingResult[]> {
    // Process in batches of batchSize
    // Pad sequences to max length within each batch
    // Run batch inference
    // L2-normalize each vector
  }

  countTokens(text: string): number {
    // Use loaded tokenizer to get exact token count
  }

  async dispose(): Promise<void> {
    // Release ONNX session
  }
}
```

**Implementation notes:**

- bge-m3 outputs 1024-dimensional dense vectors from the `[CLS]` token.
- L2 normalization: `v[i] / sqrt(sum(v[i]^2))` — MUST be enforced so cosine similarity = dot product.
- Tokenizer: Parse `tokenizer.json` (HuggingFace format). Use a minimal WordPiece tokenizer implementation or a library like `tokenizers` (if available for Node). Alternatively, implement a simple tokenizer that reads the vocab and applies basic WordPiece encoding.
- CRITICAL: Pin the model file hash in config to detect corruption.

### 6.4 `BgeM3Tokenizer`

```typescript
// packages/msrl/src/embedding/tokenizer.ts

export class BgeM3Tokenizer {
  private vocab: Map<string, number>;
  private idToToken: Map<number, string>;

  constructor(tokenizerJsonPath: string) {}

  /**
   * Load tokenizer vocabulary from HuggingFace tokenizer.json format.
   */
  async load(): Promise<void>;

  /**
   * Tokenize text to token IDs.
   * Returns { inputIds, attentionMask, tokenTypeIds, tokenCount }
   */
  encode(text: string, maxLength?: number): {
    inputIds: BigInt64Array;
    attentionMask: BigInt64Array;
    tokenTypeIds: BigInt64Array;
    tokenCount: number;
  };

  /**
   * Count tokens without full encoding (fast path).
   */
  countTokens(text: string): number;
}
```

**Decision point:** If implementing a full WordPiece tokenizer from scratch is too complex, consider using `@xenova/transformers` solely for tokenization (it can run without the model). The `OnnxBgeM3Provider` would still use `onnxruntime-node` directly for inference.

### 6.5 `VectorIndex` interface

```typescript
// packages/msrl/src/vector/vector-index.ts

export interface VectorIndex {
  /**
   * Add vectors to the index.
   * ids.length === vectors.length, each vector is Float32Array of dimension D.
   */
  add(ids: string[], vectors: Float32Array[]): void;

  /**
   * Search for nearest neighbors.
   * Returns top-k results sorted by descending similarity.
   */
  search(query: Float32Array, topK: number): VectorSearchResult[];

  /**
   * Train the index (required for IVFPQ before add).
   * trainingVectors: a representative sample of vectors.
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
```

### 6.6 `FaissShardIndex` (IVFPQ for leaf shards)

```typescript
// packages/msrl/src/vector/faiss-shard-index.ts

import { IndexFlatIP, IndexIVFPQ } from 'faiss-node';

export class FaissShardIndex implements VectorIndex {
  private index: IndexIVFPQ | null = null;
  private idMap: Map<number, string> = new Map();   // internal FAISS ID → leafId
  private reverseMap: Map<string, number> = new Map();

  constructor(private config: {
    dimension: number;    // 1024
    nlist: number;        // number of IVF cells (sqrt(expected_vectors))
    m: number;            // PQ subquantizers (64 recommended for dim=1024)
    nbits: number;        // bits per subquantizer (8)
    nprobe: number;       // cells to search at query time (default: 8)
  }) {}

  // Implementation uses faiss-node API:
  // - new IndexIVFPQ(dimension, nlist, m, nbits)
  // - train(), add(), search()
  // - writeIndex(), readIndex()
}
```

**IVFPQ parameters for bge-m3 (dim=1024):**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `nlist` | Computed: `Math.min(256, Math.floor(Math.sqrt(shardSize)))` | Adaptive to shard size (computed after threshold check) |
| `m` | 64 | 1024/64 = 16 dimensions per subquantizer |
| `nbits` | 8 | Standard, 256 centroids per subquantizer |
| `nprobe` | 16 | Higher value for accuracy priority (default was 8, increased for better recall) |

**Index type selection (Option C - Adaptive with Floor):**

```typescript
const MIN_VECTORS_FOR_IVFPQ = 1000;  // Fixed threshold, no circular dependency

function selectIndexType(shardSize: number): 'flat' | 'ivfpq' {
  if (shardSize < MIN_VECTORS_FOR_IVFPQ) {
    return 'flat';  // IndexFlatIP - brute force, 100% accurate
  }
  return 'ivfpq';   // IndexIVFPQ - approximate, ~98-99% recall with nprobe=16
}

function computeNlist(shardSize: number): number {
  // Only called for IVFPQ indexes (shardSize >= 1000)
  // nlist will be 31-256 for shards of 1000-65536 vectors
  return Math.min(256, Math.floor(Math.sqrt(shardSize)));
}
```

**Rationale:**
- **1000 vectors threshold**: Brute force on <1000 vectors is ~1ms, acceptable for accuracy
- **nprobe=16**: Doubled from default 8 to prioritize accuracy (~98-99% recall) over speed
- **No circular dependency**: Threshold is fixed; nlist computed only after deciding to use IVFPQ
- **Training**: IVFPQ indexes are trained on all vectors in the shard during snapshot build

**Training requirement:** IVFPQ requires training before adding vectors. Training learns cluster centroids (IVF) and compression codebooks (PQ). Training happens once per shard during snapshot build, using all vectors in that shard. Training time is ~100-500ms per shard.

**Memory mapping:** Native FAISS supports `IO_FLAG_MMAP` for memory-mapped index loading, but `faiss-node` does NOT expose this functionality. Instead, we rely on:
1. **Sharding** - 128 shards means we only load one shard at a time during search
2. **LRU cache** - Keep up to `maxCachedShards` (default: 16) shards in memory
3. **On-demand loading** - Cold shards are loaded from disk when needed

Memory usage estimate for cached shards:
| Vault Size | Per-Shard Index Size | 16 Cached Shards |
|------------|---------------------|------------------|
| 1K docs | ~0.5 MB | ~8 MB |
| 10K docs | ~5 MB | ~80 MB |
| 50K docs | ~25 MB | ~400 MB |

### 6.7 `HnswOutlineIndex` (for routing)

```typescript
// packages/msrl/src/vector/hnsw-outline-index.ts

import { IndexHNSWFlat } from 'faiss-node';

export class HnswOutlineIndex implements VectorIndex {
  private index: IndexHNSWFlat | null = null;
  private idMap: Map<number, string> = new Map();    // FAISS internal ID → nodeId
  private nodeToShards: Map<string, number[]> = new Map(); // nodeId → shard IDs

  constructor(private config: {
    dimension: number;    // 1024
    m: number;            // HNSW connections per layer (default: 32)
    efConstruction: number; // construction parameter (default: 200)
    efSearch: number;       // query parameter (default: 64)
  }) {}

  /**
   * After building, associate each nodeId with the shard IDs of its children.
   */
  setNodeShardMap(map: Map<string, number[]>): void;

  /**
   * Route a query: search HNSW for top-N outline nodes,
   * collect their shard IDs, deduplicate, cap at maxShards.
   */
  route(queryVector: Float32Array, topNodes: number, maxShards: number): number[];
}
```

**Outline index purpose:** Each heading node gets an embedding computed from representative leaf chunks. The HNSW index allows fast routing: "which headings/sections are relevant to this query?" → collect their shard IDs → search only those shards.

### 6.7.1 Node Embedding Calculation (MMR Representative Selection)

Instead of averaging ALL descendant leaf embeddings (which dilutes the signal for large sections), we select **representative leaves** using Maximal Marginal Relevance (MMR):

```typescript
// packages/msrl/src/vector/node-embedding.ts

/**
 * Compute node embedding using MMR-based representative leaf selection.
 * MMR balances relevance (similarity to centroid) and diversity (dissimilarity to already selected).
 */
function computeNodeEmbedding(
  node: OutlineNode,
  leafEmbeddings: Map<string, Float32Array>,
  lambda: number = 0.7  // Favor relevance slightly over diversity
): Float32Array {
  // 1. Collect all descendant leaf embeddings
  const descendantLeaves = collectAllDescendantLeaves(node);
  const embeddings = descendantLeaves.map(leaf => leafEmbeddings.get(leaf.id)!);

  if (embeddings.length === 0) {
    throw new Error(`Node ${node.id} has no descendant leaves`);
  }

  // 2. Compute adaptive k: more representatives for larger sections
  //    k = min(5, max(2, ceil(numLeaves / 5)))
  //    - 1-4 leaves → k=2 (or all if fewer)
  //    - 5-9 leaves → k=2
  //    - 10-14 leaves → k=3
  //    - 15-19 leaves → k=4
  //    - 20+ leaves → k=5 (capped)
  const k = Math.min(5, Math.max(2, Math.ceil(embeddings.length / 5)));

  if (embeddings.length <= k) {
    // Few leaves - just average them all
    return meanVector(embeddings);
  }

  // 3. Select k representative leaves using MMR
  const selected = selectMMR(embeddings, k, lambda);

  // 4. Return mean of selected representatives
  return meanVector(selected);
}

/**
 * Maximal Marginal Relevance selection.
 * Iteratively selects embeddings that are:
 *   - Similar to the centroid (relevant to the section)
 *   - Dissimilar to already selected (diverse)
 */
function selectMMR(
  embeddings: Float32Array[],
  k: number,
  lambda: number
): Float32Array[] {
  const selected: Float32Array[] = [];
  const remaining = embeddings.map((emb, i) => ({ emb, idx: i }));

  // Compute centroid of all embeddings
  const centroid = meanVector(embeddings);

  // Start with embedding closest to centroid
  remaining.sort((a, b) =>
    cosineSimilarity(b.emb, centroid) - cosineSimilarity(a.emb, centroid)
  );
  selected.push(remaining.shift()!.emb);

  // Iteratively add embeddings with best MMR score
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const emb = remaining[i].emb;

      // Relevance: similarity to centroid
      const relevance = cosineSimilarity(emb, centroid);

      // Diversity: max similarity to any already-selected embedding
      const maxSimToSelected = Math.max(
        ...selected.map(s => cosineSimilarity(emb, s))
      );

      // MMR score: lambda * relevance - (1 - lambda) * redundancy
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx].emb);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
```

**Why MMR?**
- **Relevance**: Selected leaves are similar to the section's overall content (centroid)
- **Diversity**: Avoids selecting redundant leaves that say the same thing
- **Adaptive k**: Larger sections get more representatives (2-5 based on leaf count)
- **lambda=0.7**: Slightly favors relevance over diversity

**Example:**
```
Section "Authentication" has 12 leaves about:
- [auth intro, auth basics, auth config] → cluster 1
- [JWT tokens, token refresh, token validation] → cluster 2
- [auth errors, error codes] → cluster 3
- [auth logging, audit trail] → cluster 4

k = ceil(12/5) = 3

MMR selects:
1. "auth basics" (closest to centroid)
2. "JWT tokens" (relevant + different from auth basics)
3. "auth errors" (relevant + different from both)

Node embedding = mean(auth_basics, jwt_tokens, auth_errors)
```

### 6.8 Phase 2 tests

| Test | Description |
|------|-------------|
| `embedding-determinism` | Same text produces identical vectors across calls |
| `embedding-normalization` | All vectors have L2 norm ≈ 1.0 (within 1e-6) |
| `embedding-batch-consistency` | Batch and single-item results match |
| `faiss-add-search` | Add 1000 vectors, search returns correct nearest neighbors |
| `faiss-persist-reload` | Save index, reload, search produces same results |
| `faiss-small-shard-fallback` | Shard with < training threshold uses flat index |
| `hnsw-routing` | Outline search returns correct shard IDs |
| `hnsw-max-shards-cap` | Never returns more than 16 shard IDs |
| `tokenizer-accuracy` | Token counts match expected values for test strings |
| `mmr-selection-diversity` | MMR selects diverse representatives, not just closest to centroid |
| `mmr-adaptive-k` | k scales correctly: 2 for ≤9 leaves, 3 for 10-14, etc. |
| `node-embedding-determinism` | Same node structure produces identical embedding |

### 6.9 Phase 2 deliverables checklist

- [ ] `embedding/embedding-provider.ts` — interface
- [ ] `embedding/onnx-bge-m3-provider.ts` — ONNX implementation
- [ ] `embedding/tokenizer.ts` — bge-m3 tokenizer
- [ ] `vector/vector-index.ts` — interface
- [ ] `vector/faiss-shard-index.ts` — IVFPQ implementation
- [ ] `vector/hnsw-outline-index.ts` — HNSW routing
- [ ] `vector/node-embedding.ts` — MMR representative selection
- [ ] Model download script or instructions
- [ ] All Phase 2 tests passing
- [ ] Replace Phase 1 approximate token counter with real tokenizer

---

## 7. Phase 3 — Metadata Store & BM25

**Goal:** SQLite metadata storage and FTS5-based BM25 search.

**Milestone:** Persist document/node/leaf metadata, run BM25 queries, and return normalized scores.

### 7.1 Schema DDL

```sql
-- packages/msrl/src/store/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS docs (
  doc_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uri    TEXT NOT NULL UNIQUE,
  mtime      REAL NOT NULL,          -- Unix timestamp (fractional seconds)
  size       INTEGER NOT NULL,       -- file size in bytes
  hash       TEXT NOT NULL           -- sha256 of normalized content
);

CREATE TABLE IF NOT EXISTS nodes (
  node_id       TEXT PRIMARY KEY,    -- hash(docUri + headingPath)
  doc_id        INTEGER NOT NULL REFERENCES docs(doc_id) ON DELETE CASCADE,
  level         INTEGER NOT NULL,
  heading_path  TEXT NOT NULL,
  start_char    INTEGER NOT NULL,
  end_char      INTEGER NOT NULL,
  shard_id      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_doc_id ON nodes(doc_id);
CREATE INDEX IF NOT EXISTS idx_nodes_shard_id ON nodes(shard_id);

CREATE TABLE IF NOT EXISTS leaves (
  leaf_id    TEXT PRIMARY KEY,       -- hash(docUri + startChar + endChar)
  doc_id     INTEGER NOT NULL REFERENCES docs(doc_id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  start_char INTEGER NOT NULL,
  end_char   INTEGER NOT NULL,
  text_hash  TEXT NOT NULL,          -- sha256(chunk text)
  shard_id   INTEGER NOT NULL,
  embedding  BLOB                    -- cached embedding (1024 × float32 = 4096 bytes)
);

CREATE INDEX IF NOT EXISTS idx_leaves_doc_id ON leaves(doc_id);
CREATE INDEX IF NOT EXISTS idx_leaves_node_id ON leaves(node_id);
CREATE INDEX IF NOT EXISTS idx_leaves_shard_id ON leaves(shard_id);

-- FTS5 virtual table for BM25 lexical search (CONTENTLESS)
-- content='' means text is indexed but NOT stored - zero duplication
CREATE VIRTUAL TABLE IF NOT EXISTS leaves_fts USING fts5(
  leaf_id,
  doc_uri,
  heading_path,
  text,
  content='',                    -- Contentless: index only, no text storage
  tokenize='porter unicode61'
);
```

**FTS5 Design Decision: Contentless Index**

We use a **contentless FTS5 table** (`content=''`) which:
- **Indexes** text for BM25 search (builds inverted index)
- **Does NOT store** the text (zero duplication)
- Returns `leaf_id`, `doc_uri`, `heading_path` from search, but `text` column is empty

**How excerpt retrieval works:**
1. FTS5 search returns matching `leaf_id` values
2. Look up `start_char`/`end_char` from `leaves` table
3. Read excerpt directly from original `.md` file: `file.slice(startChar, endChar)`

**Benefits:**
- Zero text duplication (text only in original files)
- Smallest snapshot size
- Files remain single source of truth
- No complex triggers needed

**Trade-off:** Excerpt retrieval requires file I/O instead of SQLite read. This is acceptable because:
- OS file caching makes repeated reads fast (<10ms for typical query)
- We batch file reads for results from the same document
- We're already reading files for final excerpt truncation

**Insert example:**
```typescript
// Text is indexed but not stored
db.prepare(`
  INSERT INTO leaves_fts(leaf_id, doc_uri, heading_path, text)
  VALUES (?, ?, ?, ?)
`).run(leafId, docUri, headingPath, chunkText);
```

**Search example:**
```typescript
// Returns leaf_id matches, text column is empty
const results = db.prepare(`
  SELECT leaf_id, doc_uri, heading_path, rank
  FROM leaves_fts
  WHERE leaves_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`).all(query, limit);

// Get excerpt from file
for (const r of results) {
  const leaf = getLeafById(r.leaf_id);
  const fileContent = await readFile(vaultRoot + '/' + r.doc_uri);
  r.excerpt = fileContent.slice(leaf.startChar, leaf.endChar);
}
```

### 7.2 `MetadataStore`

```typescript
// packages/msrl/src/store/metadata-store.ts

import Database from 'better-sqlite3';

export class MetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Run schema DDL. Idempotent. */
  initialize(): void;

  // --- Docs ---
  upsertDoc(doc: { docUri: string; mtime: number; size: number; hash: string }): number; // returns doc_id
  getDoc(docUri: string): DocRow | null;
  deleteDoc(docUri: string): void;
  listDocs(): DocRow[];
  getChangedDocs(knownDocs: Map<string, { mtime: number; hash: string }>): {
    added: string[];
    modified: string[];
    deleted: string[];
  };

  // --- Nodes ---
  insertNodes(nodes: NodeRow[]): void;   // bulk insert, uses transaction
  getNodesByDoc(docId: number): NodeRow[];
  getNodesByShardIds(shardIds: number[]): NodeRow[];

  // --- Leaves ---
  insertLeaves(leaves: LeafRow[]): void; // bulk insert, uses transaction
  getLeavesByDoc(docId: number): LeafRow[];
  getLeavesByShardIds(shardIds: number[]): LeafRow[];
  getLeavesByShard(shardId: number): LeafRowWithEmbedding[];  // for shard rebuild
  getLeafById(leafId: string): LeafRow | null;
  getLeafWithEmbedding(leafId: string): LeafRowWithEmbedding | null;  // for hybrid score computation

  // --- Embedding Cache (for incremental shard rebuild + hybrid scoring) ---
  updateLeafEmbedding(leafId: string, embedding: Float32Array): void;
  updateLeafEmbeddings(updates: { leafId: string; embedding: Float32Array }[]): void;  // bulk

  // --- FTS (Contentless) ---
  // Text is indexed but not stored. Excerpt retrieval reads from original files.
  insertFtsEntries(entries: { leafId: string; docUri: string; headingPath: string; text: string }[]): void;
  deleteFtsEntries(leafIds: string[]): void;  // Required for contentless FTS5 (no CASCADE)

  // --- Bulk ---
  deleteDocCascade(docUri: string): void; // deletes doc + nodes + leaves, then FTS entries

  // --- Integrity ---
  checkIntegrity(): { ok: boolean; errors: string[] };

  // --- Stats ---
  getCounts(): { docs: number; nodes: number; leaves: number };

  close(): void;
}
```

**Row types:**

```typescript
export interface DocRow {
  docId: number;
  docUri: string;
  mtime: number;
  size: number;
  hash: string;
}

export interface NodeRow {
  nodeId: string;
  docId: number;
  level: number;
  headingPath: string;
  startChar: number;
  endChar: number;
  shardId: number;
}

export interface LeafRow {
  leafId: string;
  docId: number;
  nodeId: string;
  startChar: number;
  endChar: number;
  textHash: string;
  shardId: number;
}

export interface LeafRowWithEmbedding extends LeafRow {
  embedding: Float32Array | null;  // null if not yet computed
}
```

**Performance:** All bulk operations MUST use `db.transaction(...)` for atomicity and speed. A single transaction inserting 10K rows is ~100x faster than 10K individual inserts.

### 7.3 `Bm25Index`

```typescript
// packages/msrl/src/store/bm25-index.ts

export interface Bm25Result {
  leafId: string;
  docUri: string;
  headingPath: string;
  bm25Score: number;          // raw FTS5 rank (negative, lower = more relevant)
  normalizedScore: number;    // normalized to 0-1 range
}

export class Bm25Index {
  constructor(private db: Database.Database) {}

  /**
   * Run BM25 search over FTS5.
   * Returns results sorted by BM25 relevance.
   *
   * FTS5 rank() returns negative values (more negative = more relevant).
   * Normalization: normalizedScore = -rank / maxAbsRank (across result set).
   */
  search(query: string, limit: number): Bm25Result[];

  /**
   * Run BM25 search restricted to specific shard IDs.
   * Uses a JOIN with leaves table filtered by shard_id.
   */
  searchInShards(query: string, shardIds: number[], limit: number): Bm25Result[];
}
```

**FTS5 query syntax mapping:**

- User query "kubernetes pod networking" → FTS5 query `kubernetes OR pod OR networking` for recall, then rank by BM25.
- Also try the exact phrase: `"kubernetes pod networking"` as a boost.
- Implementation: Run two FTS5 queries (OR and phrase), merge results, take the higher score per leaf.

### 7.4 Phase 3 tests

| Test | Description |
|------|-------------|
| `store-upsert-idempotent` | Inserting same doc twice updates, doesn't duplicate |
| `store-cascade-delete` | Deleting a doc removes nodes, leaves, FTS entries |
| `store-integrity-check` | `checkIntegrity()` returns ok on valid DB |
| `store-bulk-performance` | Insert 10K leaves in < 1 second |
| `bm25-basic-search` | Query "kubernetes" returns docs containing that term |
| `bm25-phrase-boost` | Exact phrase matches rank higher than scattered terms |
| `bm25-shard-filter` | Results only from specified shards |
| `bm25-normalization` | Scores in [0, 1] range |
| `fts5-sync` | After insert + delete, FTS results are consistent |

### 7.5 Phase 3 deliverables checklist

- [ ] `store/schema.sql` — DDL
- [ ] `store/metadata-store.ts` — full CRUD + integrity
- [ ] `store/bm25-index.ts` — FTS5 wrapper
- [ ] All Phase 3 tests passing

---

## 8. Phase 4 — Hybrid Retrieval Pipeline

**Goal:** Wire everything together into the full query flow.

**Milestone:** Given a query string and filters, execute the 9-step retrieval flow and return deterministic `SearchResult[]`.

### 8.1 Retrieval flow (9 steps)

```
Input: query string, top_k, filters, debug options

1. EMBED QUERY
   embeddingProvider.embed(query) → queryVector

2. OUTLINE ROUTING
   hnswOutlineIndex.route(queryVector, topNodes=32, maxShards=16) → shardIds[]

3. FILTER SHARDS (if filters present)
   If docUriPrefix or docUris specified:
     - Look up shard IDs for those docs via shardRouter
     - Intersect with outline-selected shards
   Else: use outline-selected shards as-is

4. ANN SEARCH (vector)
   For each shardId in shardIds:
     faissShardIndex[shardId].search(queryVector, topK * 2) → vectorCandidates[]
   Merge all vectorCandidates, deduplicate by leafId

5. BM25 SEARCH (lexical)
   bm25Index.searchInShards(query, shardIds, topK * 3) → bm25Candidates[]

6. MERGE CANDIDATE SETS
   Union of vectorCandidates and bm25Candidates by leafId
   For each candidate, ensure both scores are present:
     - If only in vector results: bm25Score = 0
     - If only in BM25 results: compute vector similarity via dot product with queryVector
       (requires loading the vector, or accept score = 0)

7. HYBRID SCORING
   hybridScore = 0.75 * vectorSimilarity + 0.25 * normalizedBm25

8. SORT + TIE-BREAK
   Sort by hybridScore DESC
   Tie-break: doc_uri ASC, then start_char ASC
   Take top_k results

9. SPAN MERGING + EXCERPT EXTRACTION
   For results from the same doc with overlapping/adjacent spans:
     Merge into a single span (union of start_char..end_char)
   Extract excerpt: normalizedText.slice(startChar, endChar)
   Enforce maxExcerptChars: truncate excerpt text but preserve original startChar/endChar.
   Set `excerptTruncated: true` flag on the result when truncation occurs.
   This flag MUST be included in SearchResult (v1 required).

Output: SearchResult[]
```

### 8.2 `RetrievalPipeline`

```typescript
// packages/msrl/src/retrieval/retrieval-pipeline.ts

export class RetrievalPipeline {
  constructor(
    private embeddingProvider: EmbeddingProvider,
    private outlineIndex: HnswOutlineIndex,
    private shardIndexes: Map<number, FaissShardIndex>,
    private metadataStore: MetadataStore,
    private bm25Index: Bm25Index,
    private shardRouter: ShardRouter,
    private config: {
      maxShardsPerQuery: number;    // 16
      vectorWeight: number;          // 0.75
      bm25Weight: number;            // 0.25
    },
  ) {}

  async query(params: QueryParams): Promise<QueryResult> {
    const startTime = performance.now();

    // Steps 1-9 as described above
    // ...

    return {
      results,
      meta: {
        tookMs: performance.now() - startTime,
        shardsSearched: params.debug?.includeShardsSearched ? shardIds : undefined,
      },
    };
  }
}
```

### 8.3 `HybridScorer`

```typescript
// packages/msrl/src/retrieval/hybrid-scorer.ts

export interface ScoredCandidate {
  leafId: string;
  docUri: string;
  headingPath: string;
  startChar: number;
  endChar: number;
  vectorScore: number;       // cosine similarity, [0, 1]
  bm25Score: number;         // normalized, [0, 1]
  hybridScore: number;       // computed
}

export class HybridScorer {
  constructor(
    private vectorWeight: number = 0.75,
    private bm25Weight: number = 0.25,
  ) {}

  /**
   * Score and sort candidates.
   * Applies deterministic tie-breaking.
   */
  scoreAndSort(candidates: ScoredCandidate[]): ScoredCandidate[] {
    // 1. Compute hybridScore for each
    // 2. Sort by hybridScore DESC
    // 3. Tie-break: doc_uri ASC, start_char ASC
    // 4. Return sorted array
  }
}
```

### 8.4 `SpanMerger`

```typescript
// packages/msrl/src/retrieval/span-merger.ts

export class SpanMerger {
  /**
   * Merge overlapping/adjacent spans from the same document.
   * Two spans are "adjacent" if the gap between them is < gapThreshold characters.
   */
  merge(
    results: ScoredCandidate[],
    gapThreshold: number = 200,
  ): ScoredCandidate[];
}
```

**Merge logic:**

1. Group candidates by `docUri`.
2. Within each group, sort by `startChar` ASC.
3. Iterate: if current span's `startChar` <= previous span's `endChar` + `gapThreshold`, merge (extend `endChar`, keep higher `hybridScore`).
4. Flatten back into a single sorted list.

### 8.5 Step 6 detail — handling missing scores

When merging vector and BM25 candidates, some candidates will only appear in one set:

```
Vector results: [chunk_A: 0.85, chunk_B: 0.72, chunk_C: 0.68]
BM25 results:   [chunk_B: 0.90, chunk_D: 0.75, chunk_E: 0.60]

chunk_A: vector=0.85, bm25=???
chunk_D: vector=???,  bm25=0.75
```

**Strategy: Compute missing vector scores, BM25 missing = 0**

- **Missing vector score:** Compute from cached embedding in SQLite (see `leaves.embedding` column). This is fair because a chunk not in vector top-K may still have decent similarity.
- **Missing BM25 score:** Use 0. This is semantically correct: if a chunk wasn't in BM25 results, the query keywords don't appear in it (or appear rarely).

```typescript
function computeHybridScores(
  vectorResults: Map<string, number>,      // leafId → vectorScore
  bm25Results: Map<string, number>,        // leafId → bm25Score
  queryVector: Float32Array,
  store: MetadataStore,
  weights: { vector: number; bm25: number } = { vector: 0.75, bm25: 0.25 }
): Map<string, number> {
  const allLeafIds = new Set([...vectorResults.keys(), ...bm25Results.keys()]);
  const scores = new Map<string, number>();

  for (const leafId of allLeafIds) {
    let vectorScore = vectorResults.get(leafId);
    const bm25Score = bm25Results.get(leafId) ?? 0;  // BM25 missing = 0

    // If missing vector score, compute from cached embedding
    if (vectorScore === undefined) {
      const leaf = store.getLeafWithEmbedding(leafId);
      if (leaf?.embedding) {
        vectorScore = cosineSimilarity(queryVector, leaf.embedding);
      } else {
        vectorScore = 0;  // fallback if embedding not cached
      }
    }

    scores.set(leafId, weights.vector * vectorScore + weights.bm25 * bm25Score);
  }

  return scores;
}
```

**Performance:** For 20 BM25-only results, this adds ~20 SQLite reads + 20 cosine similarity calculations (~1-2ms total).

### 8.6 Phase 4 tests

| Test | Description |
|------|-------------|
| `pipeline-basic-query` | End-to-end query returns results |
| `pipeline-deterministic` | Same query + corpus = same results in same order |
| `pipeline-tie-breaking` | Tied scores resolve by doc_uri ASC, start_char ASC |
| `pipeline-shard-cap` | Never searches more than 16 shards |
| `pipeline-filter-prefix` | `docUriPrefix` restricts results correctly |
| `pipeline-filter-uris` | `docUris` allowlist restricts results correctly |
| `pipeline-filter-heading` | `headingPathContains` filters correctly |
| `pipeline-span-merge` | Overlapping spans from same doc are merged |
| `pipeline-max-excerpt` | Excerpts respect maxExcerptChars |
| `pipeline-offset-accuracy` | `excerpt === file[startChar:endChar]` for all results |
| `hybrid-scoring-weights` | 0.75/0.25 weighting is correctly applied |
| `hybrid-vector-only-candidate` | BM25-only candidate gets bm25Score=0 and still ranks |

### 8.7 Phase 4 deliverables checklist

- [ ] `retrieval/retrieval-pipeline.ts` — full 9-step orchestrator
- [ ] `retrieval/hybrid-scorer.ts` — scoring + tie-breaking
- [ ] `retrieval/span-merger.ts` — adjacent span merging
- [ ] All Phase 4 tests passing
- [ ] p50 query latency < 80ms on synthetic 10K-doc corpus

---

## 9. Phase 5 — Snapshot Lifecycle & File Watcher

**Goal:** Immutable snapshot build/activate/rollback and filesystem watching.

**Milestone:** Build a complete snapshot from a vault, activate it atomically, and auto-rebuild on file changes.

### 9.1 Snapshot directory layout

```
<vault_root>/.msrl/
├── snapshots/
│   ├── 2026-02-20T230501Z/           # snapshot_id = ISO timestamp
│   │   ├── outline.faiss             # HNSW outline index
│   │   ├── leaf_shards/
│   │   │   ├── shard_000.faiss       # IVFPQ per shard
│   │   │   ├── shard_001.faiss
│   │   │   └── ...                   # up to shard_127.faiss (only non-empty shards)
│   │   ├── meta.sqlite               # SQLite database
│   │   ├── manifest.json             # Snapshot metadata
│   │   └── id_maps/
│   │       ├── outline_ids.json      # nodeId ↔ FAISS internal ID mapping
│   │       └── shard_000_ids.json    # leafId ↔ FAISS internal ID per shard
│   │       └── ...
│   ├── 2026-02-20T220000Z/           # previous snapshot (retained)
│   └── 2026-02-19T180000Z/           # oldest retained snapshot
├── CURRENT                            # text file: contains current snapshot_id
└── config.json                        # persisted MSRL config overrides
```

### 9.2 `manifest.json` schema

```typescript
export interface SnapshotManifest {
  snapshotId: string;          // ISO 8601 timestamp
  createdAt: string;           // ISO 8601
  buildDurationMs: number;
  scope: 'full' | 'incremental';
  previousSnapshotId: string | null;
  embeddingModel: string;      // "BAAI/bge-m3"
  embeddingDimension: number;  // 1024
  shardCount: number;          // 128
  stats: {
    filesIndexed: number;
    filesTotalSeen: number;
    nodesIndexed: number;
    leavesIndexed: number;
    nonEmptyShards: number;
  };
  fileHashes: {                // for integrity validation
    'outline.faiss': string;
    'meta.sqlite': string;
    [key: string]: string;     // shard files
  };
}
```

### 9.3 `SnapshotManager`

```typescript
// packages/msrl/src/lifecycle/snapshot-manager.ts

export class SnapshotManager {
  constructor(
    private msrlRoot: string,    // <vault_root>/.msrl
    private config: {
      maxRetainedSnapshots: number;  // 3
    },
  ) {}

  /**
   * Get the currently active snapshot ID.
   * Reads CURRENT file.
   */
  getCurrentSnapshotId(): string | null;

  /**
   * List all snapshot directories (excluding .building).
   */
  listSnapshots(): string[];

  /**
   * Begin a new snapshot build.
   * Creates <snapshot_id>.building/ directory.
   * Returns the snapshot build context.
   */
  beginBuild(): SnapshotBuildContext;

  /**
   * Validate a built snapshot before activation.
   * Checks: SQLite integrity, FAISS shard count, manifest consistency, smoke query.
   */
  async validate(snapshotId: string): Promise<{ ok: boolean; errors: string[] }>;

  /**
   * Atomically activate a snapshot.
   * 1. Rename <id>.building/ → <id>/
   * 2. Write CURRENT file with new snapshot_id
   * Activation lock must complete in < 50ms.
   */
  async activate(snapshotId: string): Promise<void>;

  /**
   * Clean up old snapshots beyond retention limit.
   * Keeps the most recent maxRetainedSnapshots.
   */
  async pruneOldSnapshots(): Promise<string[]>; // returns deleted IDs

  /**
   * Startup recovery:
   * 1. Remove stale *.building directories
   * 2. Validate CURRENT pointer
   * 3. If CURRENT is invalid, fallback to most recent valid snapshot
   */
  async recover(): Promise<string | null>; // returns active snapshot ID or null

  /**
   * Load a snapshot's resources for query serving.
   */
  async loadSnapshot(snapshotId: string): Promise<LoadedSnapshot>;
}

export interface SnapshotBuildContext {
  snapshotId: string;
  buildDir: string;           // <msrlRoot>/snapshots/<id>.building/
  shardDir: string;           // <buildDir>/leaf_shards/
  idMapsDir: string;          // <buildDir>/id_maps/
}

export interface LoadedSnapshot {
  snapshotId: string;
  metadataStore: MetadataStore;
  outlineIndex: HnswOutlineIndex;
  shardIndexes: Map<number, FaissShardIndex>;
  manifest: SnapshotManifest;
}
```

### 9.4 `SnapshotBuilder`

```typescript
// packages/msrl/src/lifecycle/snapshot-builder.ts

export class SnapshotBuilder {
  constructor(
    private parser: MarkdownParser,
    private chunker: Chunker,
    private embeddingProvider: EmbeddingProvider,
    private shardRouter: ShardRouter,
    private snapshotManager: SnapshotManager,
    private config: MsrlConfig,
  ) {}

  /**
   * Build a full snapshot from scratch.
   */
  async buildFull(vaultRoot: string): Promise<string>; // returns snapshot_id

  /**
   * Build an incremental snapshot based on changed files.
   * Copies unchanged data from previous snapshot.
   */
  async buildIncremental(
    vaultRoot: string,
    previousSnapshotId: string,
    changedFiles: { added: string[]; modified: string[]; deleted: string[] },
  ): Promise<string>;
}
```

**Full build algorithm:**

```
1. beginBuild() → buildContext
2. Scan vault → list all .md files (FileScanner)
3. For each file:
   a. Read + normalize
   b. Parse heading tree
   c. Chunk all nodes
   d. Assign shard IDs
4. Batch embed all chunks (embedBatch)
5. Initialize SQLite in buildContext.buildDir
6. Bulk insert docs, nodes, leaves, FTS entries
7. Group chunks by shard ID
8. For each non-empty shard:
   a. Create FaissShardIndex
   b. Train (if enough vectors) or use flat index
   c. Add vectors
   d. Save to buildContext.shardDir
   e. Save ID map
9. Compute outline embeddings (mean of leaf vectors per node)
10. Build HNSW outline index
11. Save outline index
12. Write manifest.json
13. validate(snapshotId)
14. activate(snapshotId)
15. pruneOldSnapshots()
```

**Incremental build algorithm:**

```
1. Load previous snapshot's MetadataStore
2. Compare file mtimes + hashes → changedFiles
3. beginBuild() → buildContext
4. Copy previous snapshot's SQLite → buildContext
5. For deleted files: deleteDocCascade()
6. For added/modified files:
   a. Read + normalize + parse + chunk
   b. Delete old entries for modified files
   c. Insert new entries
7. Re-embed only new/modified chunks, store in leaves.embedding
8. Rebuild affected shards using cached embeddings (see below)
9. Copy unchanged shard files from previous snapshot
10. Rebuild outline index (all node embeddings via MMR)
11. Write manifest, validate, activate, prune
```

**Shard rebuild with cached embeddings:**

FAISS `removeIds()` does not work on IVFPQ indexes, so we cannot surgically update shards.
Instead, we rebuild affected shards from scratch but use cached embeddings to avoid re-embedding.

```typescript
async function rebuildShardWithCache(
  shardId: number,
  store: MetadataStore,
  embedder: EmbeddingProvider,
  config: FaissConfig
): Promise<void> {
  // 1. Get all leaves in this shard
  const leaves = store.getLeavesByShard(shardId);

  // 2. Separate leaves with/without cached embeddings
  const cached: { leafId: string; embedding: Float32Array }[] = [];
  const needsEmbedding: { leafId: string; text: string }[] = [];

  for (const leaf of leaves) {
    if (leaf.embedding) {
      cached.push({ leafId: leaf.leafId, embedding: leaf.embedding });
    } else {
      // Read text from file using start_char/end_char
      const text = await readLeafText(leaf);
      needsEmbedding.push({ leafId: leaf.leafId, text });
    }
  }

  // 3. Embed only chunks without cached embeddings
  const newEmbeddings = await embedder.embedBatch(needsEmbedding.map(l => l.text));

  // 4. Store new embeddings in cache (SQLite)
  for (let i = 0; i < needsEmbedding.length; i++) {
    store.updateLeafEmbedding(needsEmbedding[i].leafId, newEmbeddings[i]);
  }

  // 5. Combine all embeddings
  const allEmbeddings = [
    ...cached.map(c => c.embedding),
    ...newEmbeddings
  ];
  const allLeafIds = [
    ...cached.map(c => c.leafId),
    ...needsEmbedding.map(l => l.leafId)
  ];

  // 6. Create fresh FAISS index
  const index = createFaissIndex(allEmbeddings.length, config);

  // 7. Train if IVFPQ threshold met
  if (allEmbeddings.length >= config.ivfpq.minVectorsForIvfpq) {
    const trainingData = stackVectors(allEmbeddings);
    index.train(trainingData);
  }

  // 8. Add all vectors
  index.add(stackVectors(allEmbeddings));

  // 9. Save index and ID map
  index.write(shardIndexPath(shardId));
  saveIdMap(shardId, allLeafIds);
}
```

**Performance comparison (10K doc vault, 1 file changed):**

| Approach | Re-embed | Rebuild Index | Total Time |
|----------|----------|---------------|------------|
| No cache (re-embed all) | ~1000 chunks × 50ms = 50s | ~500ms | **~50 seconds** |
| With cache | ~5 chunks × 50ms = 250ms | ~500ms | **~750ms** |

**Storage overhead:** ~4KB per chunk (1024 × float32). For 10K docs (~150K chunks): ~600MB.

### 9.5 `FileScanner`

```typescript
// packages/msrl/src/lifecycle/file-scanner.ts

export class FileScanner {
  constructor(private config: {
    vaultRoot: string;
    ignoredPatterns: string[];  // ['.msrl/**', '.git/**', '.obsidian/**', 'node_modules/**']
  }) {}

  /**
   * Scan vault and return all indexable .md files.
   */
  async scanAll(): Promise<ScannedFile[]>;

  /**
   * Detect changes since last known state.
   */
  async detectChanges(
    knownFiles: Map<string, { mtime: number; hash: string }>,
  ): Promise<{
    added: ScannedFile[];
    modified: ScannedFile[];
    deleted: string[];         // doc_uris
  }>;
}

export interface ScannedFile {
  docUri: string;              // vault-relative POSIX path
  absolutePath: string;
  mtime: number;               // Unix timestamp
  size: number;
  hash: string;                // sha256 of normalized content
}
```

**Ignored paths (hardcoded defaults):**

```typescript
const DEFAULT_IGNORED_PATTERNS = [
  '.msrl/**',
  '.git/**',
  '.obsidian/**',
  'node_modules/**',
  '**/.*',          // all hidden directories/files
  '**/*.tmp',
  '**/*~',
];
```

### 9.6 `FileWatcher`

```typescript
// packages/msrl/src/lifecycle/file-watcher.ts

import { watch } from 'chokidar';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();

  constructor(
    private config: {
      vaultRoot: string;
      debounceMs: number;          // default: 2000
      ignoredPatterns: string[];
    },
    private onBatch: (changedPaths: string[]) => Promise<void>,
  ) {}

  /**
   * Start watching the vault.
   */
  async start(): Promise<void>;

  /**
   * Stop watching.
   */
  async stop(): Promise<void>;

  /**
   * Update debounce interval.
   */
  setDebounce(ms: number): void;

  /**
   * Current state.
   */
  getState(): {
    enabled: boolean;
    debounceMs: number;
    queueDepth: number;
    lastEventUtc: string | null;
  };
}
```

**Watcher behavior:**

1. Watch `vaultRoot` recursively for `.md` files.
2. On any `add`/`change`/`unlink` event for a `.md` file, add to `pendingChanges`.
3. Reset debounce timer to `debounceMs`.
4. When timer fires: collect all `pendingChanges`, clear the set, call `onBatch(changedPaths)`.
5. The `onBatch` callback triggers `SnapshotBuilder.buildIncremental()`.

**Watcher state persistence:**

The watcher enabled state is **NOT persisted** across restarts. On each startup:
- Watcher state is determined by `config.watcher.enabled` (default: `true`)
- `msrl.watch` tool changes are ephemeral (session-only)
- Restart always returns to config default

**Rationale:**
- Simple: no runtime state file to manage
- Predictable: config is source of truth
- Safe: if watcher is disabled for debugging, restart restores normal operation
- Users who want watcher disabled permanently can set `MSRL_WATCHER_ENABLED=false` in env

### 9.7 Phase 5 tests

| Test | Description |
|------|-------------|
| `snapshot-build-full` | Build from a 100-file test vault, verify manifest |
| `snapshot-validate-ok` | Valid snapshot passes validation |
| `snapshot-validate-corrupt` | Missing shard file fails validation |
| `snapshot-activate-atomic` | CURRENT file updated, rename succeeds |
| `snapshot-activation-latency` | Activation < 50ms |
| `snapshot-rollback` | After failed build, CURRENT still points to previous |
| `snapshot-prune` | Only 3 most recent snapshots retained |
| `snapshot-recover-stale` | `.building` dirs cleaned up on startup |
| `snapshot-recover-invalid` | Invalid CURRENT falls back to most recent valid |
| `incremental-build` | Modify 1 file → new snapshot reflects change |
| `incremental-unchanged` | Unchanged shards are byte-identical copies |
| `watcher-debounce` | Multiple rapid changes produce single batch |
| `watcher-md-only` | Non-MD file changes are ignored |
| `watcher-ignored-paths` | Changes in .git/, .obsidian/ are ignored |
| `scanner-hidden-dirs` | Hidden directories are excluded |

### 9.8 Phase 5 deliverables checklist

- [ ] `lifecycle/snapshot-manager.ts` — build/validate/activate/rollback/prune/recover
- [ ] `lifecycle/snapshot-builder.ts` — full + incremental build
- [ ] `lifecycle/file-scanner.ts` — vault scanning + change detection
- [ ] `lifecycle/file-watcher.ts` — chokidar wrapper
- [ ] All Phase 5 tests passing
- [ ] Full build of 1000-file test vault completes without error

---

## 10. Phase 6 — MCP Tool Integration

**Goal:** Wire `MsrlEngine` into the existing MCP server as tools.

**Milestone:** All four core tools (`msrl.query`, `msrl.status`, `msrl.reindex`, `msrl.watch`) registered and functional.

### 10.1 `MsrlEngine` assembly

```typescript
// packages/msrl/src/engine.ts

export class MsrlEngine {
  private snapshotManager: SnapshotManager;
  private embeddingProvider: EmbeddingProvider;
  private currentSnapshot: LoadedSnapshot | null = null;
  private fileWatcher: FileWatcher | null = null;
  private buildLock: boolean = false;
  private config: MsrlConfig;

  private constructor(config: MsrlConfig) {
    this.config = config;
  }

  /**
   * Factory method. Handles full initialization:
   * 1. Validate config
   * 2. Initialize embedding provider
   * 3. Run snapshot recovery
   * 4. Load current snapshot (if any)
   * 5. Start file watcher (if configured)
   * 6. If no snapshot exists, trigger initial full build
   */
  static async create(config: MsrlConfig): Promise<MsrlEngine>;

  /**
   * Hybrid search.
   * Throws MsrlError('NOT_INDEXED') if no snapshot is loaded.
   */
  async query(params: QueryParams): Promise<QueryResult>;

  /**
   * Trigger reindex.
   *
   * Concurrent reindex behavior:
   * - Only ONE build can run at a time (mutex)
   * - If wait=false and build in progress: throws MsrlError('INDEX_BUSY')
   * - If wait=true and build in progress: waits for current build to complete,
   *   then starts a new build (does NOT piggyback on existing build)
   *
   * Rationale: Piggybacking is complex (what if scopes differ?) and rarely needed.
   * Callers can check getStatus().state === 'building' before calling.
   */
  async reindex(params: ReindexParams): Promise<ReindexResult>;

  /**
   * Get current status.
   */
  getStatus(): IndexStatus;

  /**
   * Toggle watcher.
   */
  async setWatch(params: WatchParams): Promise<WatchResult>;

  /**
   * Clean shutdown.
   */
  async shutdown(): Promise<void>;

  // --- Private ---
  private async onFileChanges(changedPaths: string[]): Promise<void>;
  private async swapSnapshot(newSnapshotId: string): Promise<void>;
}

export interface IndexStatus {
  state: 'ready' | 'building' | 'error';
  snapshotId: string | null;       // null if no snapshot loaded
  snapshotTimestamp: string | null; // ISO 8601
  stats: {
    docs: number;
    nodes: number;
    leaves: number;
    shards: number;
  };
  watcher: {
    enabled: boolean;
    debounceMs: number;
  };
  error?: string;                  // Present if state === 'error'
}
```

### 10.1.1 Empty Vault Handling

An empty vault (no `.md` files) is a valid state, not an error. MSRL handles it gracefully:

**Behavior:**
- `MsrlEngine.create()` succeeds, creates an empty snapshot
- `query()` returns `{ results: [], meta: { tookMs: N, shardsSearched: [] } }`
- `getStatus()` returns `{ state: 'ready', stats: { docs: 0, nodes: 0, leaves: 0, shards: 0 }, ... }`
- `reindex()` succeeds, produces a new empty snapshot
- File watcher works normally, will trigger reindex when files are added

**No errors thrown for:**
- Empty vault at startup
- All files deleted while running
- Query on empty index

**Errors ARE thrown for:**
- Invalid vault path (directory doesn't exist)
- Permission denied on vault directory
- Corrupted snapshot files

### 10.2 MCP tool registration

```typescript
// src/tools/msrl-tools.ts  (in main src/, NOT in packages/msrl/)

import { MsrlEngine, type MsrlConfig, msrlConfigSchema } from '@msrl/core';
import { z } from 'zod';

// --- Lazy initialization ---
let engine: MsrlEngine | null = null;

async function getEngine(): Promise<MsrlEngine> {
  if (!engine) {
    const config = loadMsrlConfig();  // from env vars or config file
    engine = await MsrlEngine.create(config);
  }
  return engine;
}

// --- Tool definitions ---

export const msrlQueryDefinition = {
  name: 'msrl.query',
  description: 'Hybrid search (vector + BM25) over vault Markdown and return exact excerpts with provenance.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, description: 'User query text.' },
      top_k: { type: 'integer', minimum: 1, maximum: 50, default: 8 },
      max_excerpt_chars: { type: 'integer', minimum: 200, maximum: 20000, default: 4000 },
      filters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          doc_uri_prefix: { type: 'string' },
          doc_uris: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 },
          heading_path_contains: { type: 'string' },
        },
      },
      debug: {
        type: 'object',
        additionalProperties: false,
        properties: {
          include_scores: { type: 'boolean', default: true },
          include_shards_searched: { type: 'boolean', default: false },
        },
      },
    },
  },
};

export async function handleMsrlQuery(args: Record<string, unknown>) {
  const eng = await getEngine();
  // Validate args with Zod, map snake_case → camelCase, call eng.query()
  // Map result back to snake_case for MCP response
}

export const msrlStatusDefinition = {
  name: 'msrl.status',
  description: 'Return MSRL index and watcher status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
};

export async function handleMsrlStatus() {
  const eng = await getEngine();
  return eng.getStatus();
}

export const msrlReindexDefinition = {
  name: 'msrl.reindex',
  description: 'Trigger vault reindexing. Supports full, incremental, or prefix-scoped rebuild.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scope: { type: 'string', enum: ['changed', 'full', 'prefix'], default: 'changed' },
      doc_uri_prefix: { type: 'string' },
      wait: { type: 'boolean', default: false },
    },
  },
};

export async function handleMsrlReindex(args: Record<string, unknown>) {
  const eng = await getEngine();
  // Validate, call eng.reindex(), return result
}

export const msrlWatchDefinition = {
  name: 'msrl.watch',
  description: 'Enable or disable the filesystem watcher for automatic reindexing.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['enabled'],
    properties: {
      enabled: { type: 'boolean' },
      debounce_ms: { type: 'integer', minimum: 250, maximum: 30000, default: 2000 },
    },
  },
};

export async function handleMsrlWatch(args: Record<string, unknown>) {
  const eng = await getEngine();
  // Validate, call eng.setWatch(), return result
}

// --- Export all definitions ---
export const msrlToolDefinitions = [
  { definition: msrlQueryDefinition, handler: handleMsrlQuery },
  { definition: msrlStatusDefinition, handler: handleMsrlStatus },
  { definition: msrlReindexDefinition, handler: handleMsrlReindex },
  { definition: msrlWatchDefinition, handler: handleMsrlWatch },
];
```

### 10.3 Integration into `src/index.ts`

```typescript
// Add to existing src/index.ts

import { msrlToolDefinitions } from './tools/msrl-tools.js';

// In tool registration section:
const allToolDefinitions = [
  ...existingToolDefinitions,
  ...msrlToolDefinitions.map(t => t.definition),
];

// In tool handler dispatch:
// Add cases for 'msrl.query', 'msrl.status', 'msrl.reindex', 'msrl.watch'
```

### 10.4 Error mapping

```typescript
// packages/msrl/src/types.ts

export class MsrlError extends Error {
  constructor(
    public code: MsrlErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MsrlError';
  }
}

export type MsrlErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'NOT_INDEXED'
  | 'INDEX_BUSY'
  | 'INDEX_CORRUPT'
  | 'IO_ERROR'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'INTERNAL';
```

**Error details structure by code:**

| Code | When thrown | Details structure |
|------|-------------|-------------------|
| `INVALID_ARGUMENT` | Invalid input to any method | `{ field: string, value: unknown, reason: string, validOptions?: string[] }` |
| `NOT_FOUND` | doc.* tools: doc_uri or heading_path not found | `{ docUri?: string, headingPath?: string }` |
| `NOT_INDEXED` | Query called before any snapshot loaded | `{}` (no details needed) |
| `INDEX_BUSY` | Reindex called while build in progress (wait=false) | `{ currentBuildStartedAt: string }` |
| `INDEX_CORRUPT` | Snapshot validation failed | `{ snapshotId: string, reason: string, missingFiles?: string[] }` |
| `IO_ERROR` | File read/write failed | `{ path: string, operation: 'read' \| 'write', errno?: string }` |
| `MODEL_DOWNLOAD_FAILED` | Model download failed | `{ url: string, reason: string }` |
| `INTERNAL` | Unexpected error (bug) | `{ originalError?: string }` |

**Example error messages:**

```typescript
// INVALID_ARGUMENT
throw new MsrlError('INVALID_ARGUMENT', 'Invalid scope value', {
  field: 'scope',
  value: 'invalid',
  reason: 'Must be one of: changed, full, prefix',
  validOptions: ['changed', 'full', 'prefix'],
});

// NOT_FOUND
throw new MsrlError('NOT_FOUND', 'Document not found', {
  docUri: 'notes/missing.md',
});

// INDEX_CORRUPT
throw new MsrlError('INDEX_CORRUPT', 'Snapshot validation failed', {
  snapshotId: '20260220-143052-abc123',
  reason: 'Missing shard files',
  missingFiles: ['shards/shard_007.faiss', 'shards/shard_042.faiss'],
});
```

In the MCP tool handler, catch `MsrlError` and convert to the MCP SDK `CallToolResult` error format. This follows the same pattern used by the existing obsidian_mcp tools (returning `isError: true` with a text content block):

```typescript
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function msrlErrorToMcpResult(err: MsrlError): CallToolResult {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      }),
    }],
  };
}

// In each tool handler:
try {
  const result = await handler(args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
} catch (err) {
  if (err instanceof MsrlError) {
    return msrlErrorToMcpResult(err);
  }
  // Unexpected error → wrap as INTERNAL
  return msrlErrorToMcpResult(
    new MsrlError('INTERNAL', err instanceof Error ? err.message : 'Unknown error')
  );
}
```

**Important:** Never let unhandled exceptions propagate to the MCP SDK — always catch and wrap. This matches the existing obsidian_mcp error handling convention.

### 10.5 Phase 6 tests

| Test | Description |
|------|-------------|
| `tool-query-basic` | `msrl.query` returns results for a valid query |
| `tool-query-filters` | Filters correctly restrict results |
| `tool-query-not-indexed` | Returns NOT_INDEXED error when no snapshot |
| `tool-status-fields` | `msrl.status` returns all required fields |
| `tool-reindex-changed` | Incremental reindex reflects file changes |
| `tool-reindex-full` | Full reindex rebuilds everything |
| `tool-reindex-busy` | Returns INDEX_BUSY when build in progress |
| `tool-reindex-wait` | `wait=true` blocks until completion |
| `tool-watch-toggle` | Enable/disable reflected in status |
| `tool-watch-debounce` | Custom debounce persists |
| `integration-e2e` | Full flow: reindex → query → verify results |
| `error-format` | All errors match MCP error schema |

### 10.6 Phase 6 deliverables checklist

- [ ] `packages/msrl/src/engine.ts` — full MsrlEngine
- [ ] `src/tools/msrl-tools.ts` — tool definitions + handlers
- [ ] `src/index.ts` — updated to register MSRL tools
- [ ] All Phase 6 tests passing
- [ ] End-to-end test with real MCP client

---

## 11. Phase 7 — Optional doc.* Tools

**Goal:** Structured write tools for Markdown manipulation. These are optional and can ship after the core search tools.

### 11.1 Tool summary

| Tool | Purpose |
|------|---------|
| `msrl.doc.validate` | Validate MD against MSRL policy (heading jumps, structure) |
| `msrl.doc.auto_fix` | Auto-fix safe violations |
| `msrl.doc.create` | Create new MD from template |
| `msrl.doc.insert_section` | Insert section under parent heading |
| `msrl.doc.replace_section` | Replace section body |
| `msrl.doc.append_to_section` | Append to section |
| `msrl.doc.move_section` | Move section subtree |

### 11.2 `DocValidator`

```typescript
// packages/msrl/src/doc/doc-validator.ts

export interface ValidationViolation {
  rule: string;           // e.g. 'heading-jump', 'duplicate-sibling'
  message: string;
  startLine: number;
  endLine?: number;
  suggestedFix?: string;
}

export class DocValidator {
  /**
   * Validate a Markdown document.
   * Rules:
   * - No heading level jumps > 1 (H1 → H3 without H2)
   * - No duplicate sibling headings at the same level
   * - Single H1 per document (optional, configurable)
   */
  validate(normalizedText: string): { ok: boolean; violations: ValidationViolation[] };
}
```

### 11.3 `DocWriter`

```typescript
// packages/msrl/src/doc/doc-writer.ts

export class DocWriter {
  constructor(private parser: MarkdownParser) {}

  /**
   * Create a new document with optional template.
   */
  createDocument(params: {
    absolutePath: string;
    title: string;
    templateId?: string;
    overwrite?: boolean;
  }): Promise<boolean>;

  /**
   * Insert a new section under a parent heading.
   */
  insertSection(params: {
    absolutePath: string;
    parentHeadingPath: string;
    heading: string;
    contentMd: string;
    level?: number;
  }): Promise<boolean>;

  /**
   * Replace the body of a section (preserving children).
   */
  replaceSection(params: {
    absolutePath: string;
    headingPath: string;
    contentMd: string;
  }): Promise<boolean>;

  /**
   * Append content to the end of a section (before children).
   */
  appendToSection(params: {
    absolutePath: string;
    headingPath: string;
    contentMd: string;
  }): Promise<boolean>;

  /**
   * Move a section subtree to a different parent.
   */
  moveSection(params: {
    absolutePath: string;
    fromHeadingPath: string;
    toParentHeadingPath: string;
  }): Promise<boolean>;
}
```

**Section manipulation algorithm:**

All doc.* write operations follow the same pattern:

1. Read file → normalize → parse heading tree.
2. Locate target heading node by `headingPath` string matching.
3. Compute the character range to modify.
4. Perform the string operation (insert/replace/delete) on the normalized text.
5. Write back to disk.
6. The file watcher will pick up the change and trigger re-indexing.

**Heading path resolution:** Given a path like `"Infra → Kubernetes → k3s"`, walk the heading tree from root matching each segment by title (case-sensitive). Return error if any segment is not found. The separator is ` → ` (Unicode U+2192).

### 11.4 Phase 7 deliverables checklist

- [ ] `doc/doc-validator.ts`
- [ ] `doc/doc-writer.ts`
- [ ] MCP tool definitions for all 7 doc.* tools
- [ ] Tests for each tool
- [ ] Validation violations have actionable messages

---

## 12. Cross-Cutting Concerns

### 12.1 Logging

Use `stderr` for all logs (MCP convention — stdout is reserved for protocol messages).

```typescript
// packages/msrl/src/logger.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  // Writes structured JSON to stderr
  // Format: {"ts":"ISO","level":"info","component":"SnapshotBuilder","msg":"...","data":{}}
}
```

### 12.2 Concurrency safety

- `MsrlEngine.query()` reads from the current `LoadedSnapshot`. Reads are safe with SQLite WAL mode (multiple concurrent readers OK).
- `MsrlEngine.reindex()` uses a `buildLock` boolean. Only one build at a time. Build happens on a separate "thread" (using `setImmediate` / microtask scheduling to avoid blocking the event loop for long operations).
- `swapSnapshot()` is the critical section: atomically update `this.currentSnapshot`. Since Node.js is single-threaded, a simple reference swap is atomic. The old snapshot's resources are released after a short delay (allow in-flight queries to complete).

```typescript
private async swapSnapshot(newSnapshotId: string): Promise<void> {
  const newSnapshot = await this.snapshotManager.loadSnapshot(newSnapshotId);
  const oldSnapshot = this.currentSnapshot;
  this.currentSnapshot = newSnapshot;  // atomic in single-threaded Node.js

  // Release old snapshot after 5 seconds (grace period for in-flight queries)
  if (oldSnapshot) {
    setTimeout(() => {
      oldSnapshot.metadataStore.close();
      // FAISS indexes don't need explicit close in faiss-node
    }, 5000);
  }
}
```

### 12.3 Memory management

**Target:** < 8GB resident during query phase.

Key concerns:

1. **ONNX model:** ~600MB (INT8 quantized). Loaded once, kept in memory.
2. **FAISS indexes:** Only the currently-searched shards need to be in memory. Use memory-mapped FAISS indexes (`IO_FLAG_MMAP`) if `faiss-node` supports it. Otherwise, load all 128 shard indexes into memory (~2-4GB depending on corpus size).
3. **SQLite:** WAL mode uses mmap for reads. Memory-efficient.
4. **Embedding vectors during build:** Batch processing prevents loading all vectors at once.

**If memory is a concern:** Implement a shard LRU cache that loads only the 16 most recently searched shards and evicts others.

### 12.4 Error handling strategy

1. All errors within MSRL throw `MsrlError` with typed codes.
2. The MCP tool handler layer catches these and converts to MCP error format.
3. Unexpected errors (bugs) throw standard `Error` — the MCP handler wraps these as `INTERNAL`.
4. File I/O errors are caught and wrapped as `IO_ERROR`.
5. Invalid user input is caught at the Zod validation layer and returned as `INVALID_ARGUMENT`.

### 12.5 Determinism contract

The following MUST hold:

```
Given:
  - Identical corpus (same files, same content)
  - Identical config (same chunker params, same model, same shard count)
  - Identical query (same string, same filters)

Then:
  - Chunk boundaries are identical
  - Embedding vectors are identical (within floating-point tolerance)
  - Hybrid scores are identical (within floating-point tolerance)
  - Result ordering is identical
  - Excerpts are identical (exact string match)
```

This is enforced by:

- Deterministic normalization (MarkdownParser.normalize)
- Deterministic heading parsing (no non-deterministic data structures)
- Deterministic chunk boundaries (no randomness in chunker)
- Pinned embedding model (same ONNX model file = same outputs)
- Deterministic FNV-1a shard assignment
- Deterministic tie-breaking (doc_uri ASC, start_char ASC)

---

## 13. Test Strategy

### 13.1 Test infrastructure

```
packages/msrl/
├── vitest.config.ts
├── src/
│   ├── parser/__tests__/
│   │   ├── fixtures/
│   │   │   ├── simple.md
│   │   │   ├── nested-headings.md
│   │   │   ├── fenced-blocks.md
│   │   │   ├── large-file.md        # 50KB+ for performance tests
│   │   │   └── edge-cases.md        # empty file, no headings, etc.
│   │   ├── markdown-parser.test.ts
│   │   ├── chunker.test.ts
│   │   └── fence-detector.test.ts
│   ├── embedding/__tests__/
│   ├── vector/__tests__/
│   ├── store/__tests__/
│   ├── retrieval/__tests__/
│   ├── lifecycle/__tests__/
│   └── __tests__/
│       ├── integration.test.ts      # Full pipeline integration
│       └── performance.test.ts      # Latency benchmarks
```

### 13.2 Test categories

| Category | Runner | Scope |
|----------|--------|-------|
| Unit tests | `vitest` | Per-module, mocked dependencies |
| Integration tests | `vitest` | Full pipeline, real SQLite, test vault |
| Performance tests | `vitest` with `bench` | Latency p50/p95/p99, throughput |
| Determinism tests | `vitest` | Verify identical input → identical output |

### 13.3 Test vault generator

Create a script to generate synthetic test vaults:

```typescript
// packages/msrl/src/__tests__/generate-test-vault.ts

export function generateTestVault(params: {
  outputDir: string;
  fileCount: number;
  avgSectionsPerFile: number;
  avgWordsPerSection: number;
  includeCodeBlocks: boolean;
  includeFrontmatter: boolean;
}): Promise<void>;
```

Generate vaults of different sizes for testing: 10 files (unit), 100 files (integration), 10K files (performance).

### 13.4 Mandatory test matrix (from original spec)

- [ ] Parsing correctness — heading tree matches expected structure
- [ ] Span accuracy — `text.slice(startChar, endChar)` matches chunk text
- [ ] Fence integrity — no chunks split inside fenced blocks
- [ ] Shard stability — same doc_uri always maps to same shard
- [ ] Snapshot crash recovery — stale .building dirs cleaned, fallback works
- [ ] Hybrid scoring correctness — weights applied correctly
- [ ] Deterministic ordering — identical input → identical output order
- [ ] Performance smoke tests — p50 < 80ms, p95 < 300ms on test corpus

---

## 14. Performance Budgets & Benchmarks

### 14.1 Query latency targets

| Metric | Target | Test corpus |
|--------|--------|-------------|
| p50 | < 80ms | 10K docs, 1.5M leaves |
| p95 | < 300ms | 10K docs, 1.5M leaves |
| p99 | < 800ms | 10K docs, 1.5M leaves |
| Snapshot activation | < 50ms | — |

### 14.2 Indexing throughput

| Metric | Target |
|--------|--------|
| CPU-only full rebuild | >= 10MB/s of Markdown content |
| 5GB vault full rebuild | < 2 hours |
| Incremental (single file change) | < 10 seconds end-to-end |

### 14.3 Memory targets

| Phase | Budget |
|-------|--------|
| Query serving | < 8GB resident |
| Full rebuild | < 16GB peak |
| Idle (watcher only) | < 2GB resident |

### 14.4 Benchmark script

```typescript
// packages/msrl/src/__tests__/performance.test.ts

import { bench, describe } from 'vitest';

describe('MSRL Performance', () => {
  bench('query p50', async () => {
    await engine.query({ query: 'kubernetes networking pod' });
  }, { iterations: 100, warmupIterations: 10 });

  bench('embedding single', async () => {
    await provider.embed('test text for embedding');
  }, { iterations: 50 });

  bench('embedding batch 32', async () => {
    await provider.embedBatch(texts32);
  }, { iterations: 10 });
});
```

---

## 15. Configuration Schema

```typescript
// packages/msrl/src/config.ts

import { z } from 'zod';

export const msrlConfigSchema = z.object({
  // --- Required ---
  vaultRoot: z.string().min(1),

  // --- Embedding ---
  embedding: z.object({
    modelPath: z.string().default('./models/bge-m3/model.onnx'),
    tokenizerPath: z.string().default('./models/bge-m3/tokenizer.json'),
    maxSequenceLength: z.number().default(8192),
    numThreads: z.number().min(1).max(32).default(4),
    batchSize: z.number().min(1).max(128).default(32),
  }).default({}),

  // --- Chunking ---
  chunking: z.object({
    targetMinTokens: z.number().default(600),
    targetMaxTokens: z.number().default(1000),
    hardMaxTokens: z.number().default(1200),
    minPreferredTokens: z.number().default(200),
    overlapTokens: z.number().default(100),
  }).default({}),

  // --- Sharding ---
  sharding: z.object({
    shardCount: z.number().default(128),
    maxShardsPerQuery: z.number().default(16),
  }).default({}),

  // --- Retrieval ---
  retrieval: z.object({
    vectorWeight: z.number().min(0).max(1).default(0.75),
    bm25Weight: z.number().min(0).max(1).default(0.25),
    defaultTopK: z.number().default(8),
    defaultMaxExcerptChars: z.number().default(4000),
    spanMergeGapThreshold: z.number().default(200),
  }).default({}),

  // --- FAISS ---
  faiss: z.object({
    // Shard LRU cache - keeps recently-used shards in memory
    // Note: faiss-node does NOT support memory mapping (IO_FLAG_MMAP)
    // We rely on sharding (128 shards) + LRU cache to manage memory
    maxCachedShards: z.number().min(1).max(128).default(16),  // ~80-400 MB depending on vault size
    ivfpq: z.object({
      minVectorsForIvfpq: z.number().default(1000),  // Below this, use IndexFlatIP
      m: z.number().default(64),         // PQ subquantizers
      nbits: z.number().default(8),
      nprobe: z.number().default(16),    // Higher for accuracy priority
    }).default({}),
    hnsw: z.object({
      m: z.number().default(32),
      efConstruction: z.number().default(200),
      efSearch: z.number().default(64),
    }).default({}),
  }).default({}),

  // --- Lifecycle ---
  lifecycle: z.object({
    maxRetainedSnapshots: z.number().min(1).default(3),
    ignoredPatterns: z.array(z.string()).default([
      '.msrl/**', '.git/**', '.obsidian/**', 'node_modules/**',
      '**/.*', '**/*.tmp', '**/*~',
    ]),
  }).default({}),

  // --- Watcher ---
  watcher: z.object({
    enabled: z.boolean().default(true),
    debounceMs: z.number().min(250).max(30000).default(2000),
  }).default({}),

  // --- Logging ---
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type MsrlConfig = z.infer<typeof msrlConfigSchema>;
```

**Config loading order:**

1. Defaults from Zod schema
2. `<vault_root>/.msrl/config.json` (persisted overrides)
3. Environment variables: `MSRL_VAULT_ROOT`, `MSRL_LOG_LEVEL`, `MSRL_EMBEDDING_NUM_THREADS`, etc.
4. Explicit parameters passed to `MsrlEngine.create()`

---

## 16. Migration & Rollout Plan

### 16.1 Phase order and dependencies

```
Phase 1: Parser & Chunker       (no native deps, pure TS)
    ↓
Phase 2: Embedding & Vector      (requires onnxruntime-node, faiss-node)
    ↓
Phase 3: Metadata Store & BM25   (requires better-sqlite3)
    ↓
Phase 4: Hybrid Retrieval        (wires 1-3 together)
    ↓
Phase 5: Snapshot & Watcher      (requires chokidar, filesystem)
    ↓
Phase 6: MCP Integration         (wires into existing server)
    ↓
Phase 7: doc.* Tools             (optional, pure TS)
```

### 16.2 Phase 1 checkpoint

After Phase 1, the implementation agent should have:

- Working parser that handles all Markdown edge cases
- Deterministic chunker with full test coverage
- No native dependencies yet — runs on any machine

**Validation:** Run the test suite. Manually inspect chunk output for a sample Obsidian vault.

### 16.3 Phase 2 checkpoint

After Phase 2:

- Native dependencies installed and linking correctly
- Model downloaded and loadable
- Embedding produces normalized 1024-d vectors
- FAISS indexes build and search correctly

**Validation:** Embed 100 chunks, build a single shard index, search and verify nearest-neighbor accuracy.

### 16.4 Phase 3 checkpoint

After Phase 3:

- SQLite database created with correct schema
- FTS5 index working
- BM25 search returns ranked results

**Validation:** Insert 1000 leaves, run FTS5 queries, verify results.

### 16.5 Phase 4 checkpoint

After Phase 4:

- Full retrieval pipeline works end-to-end
- Hybrid scoring produces sensible results
- All determinism tests pass

**Validation:** Run 50 queries against a 100-file test vault. Verify offset accuracy for every result.

### 16.6 Phase 5 checkpoint

After Phase 5:

- Full snapshot build + activation working
- Incremental builds working
- File watcher triggers rebuilds
- Recovery from corrupted state works

**Validation:** Build a snapshot, corrupt it, verify recovery. Modify files, verify watcher triggers rebuild.

### 16.7 Phase 6 checkpoint (v1 ship)

After Phase 6:

- All 4 core MCP tools registered and functional
- End-to-end test: start server → reindex → query → verify
- Performance benchmarks pass

**Validation:** Run the existing `obsidian_mcp` test suite to ensure no regressions. Run MSRL-specific integration tests.

### 16.8 Rollback strategy

- MSRL tools are additive (new tools, no existing tools modified).
- If MSRL fails to initialize, the existing MCP server should still start normally (lazy initialization means failure only occurs on first MSRL tool call).
- Feature flag: `MSRL_ENABLED=false` skips MSRL tool registration entirely.

---

## Appendix A: Hash Functions

| Purpose | Algorithm | Implementation |
|---------|-----------|----------------|
| Shard assignment | FNV-1a (32-bit) | Custom implementation (fast, deterministic) |
| Content hashing | SHA-256 | `crypto.createHash('sha256')` |
| Node ID | SHA-256 truncated | `sha256(docUri + ':' + headingPath).slice(0, 16)` |
| Leaf ID | SHA-256 truncated | `sha256(docUri + ':' + startChar + ':' + endChar).slice(0, 16)` |

## Appendix B: FNV-1a Implementation

```typescript
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // Convert to unsigned 32-bit
}

export function shardId(docUri: string, shardCount: number): number {
  return fnv1a32(docUri) % shardCount;
}
```

## Appendix C: Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MSRL_ENABLED` | `true` | Enable/disable MSRL tool registration |
| `MSRL_VAULT_ROOT` | (from server config) | Override vault root path |
| `MSRL_LOG_LEVEL` | `info` | Log verbosity |
| `MSRL_MODEL_PATH` | `./models/bge-m3/model.onnx` | Path to ONNX model |
| `MSRL_EMBEDDING_THREADS` | `4` | ONNX inference threads |
| `MSRL_WATCHER_ENABLED` | `true` | Auto-start file watcher |
| `MSRL_WATCHER_DEBOUNCE_MS` | `2000` | Watcher debounce |
