# md_retriever (MSRL)

**Markdown-native Structured Retrieval Library** — A hybrid search engine for Obsidian vaults.

MSRL indexes Markdown files into a hierarchical structure (heading tree → chunks), builds FAISS vector indexes + SQLite FTS5 for hybrid search, and returns exact excerpts with provenance.

## Features

- **Hybrid Search**: Combines vector similarity (75%) + BM25 keyword matching (25%)
- **Hierarchical Indexing**: Respects Markdown heading structure for better context
- **Exact Provenance**: Returns `docUri`, `headingPath`, `startChar`, `endChar` for every result
- **Incremental Updates**: Only re-indexes changed files (~750ms for single file change)
- **File Watching**: Auto-reindex on file changes with debouncing
- **Immutable Snapshots**: Atomic updates with rollback capability

## Installation

```bash
# As a dependency in your project
npm install @ostanlabs/md-retriever

# Or link locally (for development)
npm link ./md_retriever
```

### Model Download

On first run, MSRL downloads the bge-m3 embedding model (~615MB) from HuggingFace:

```bash
# Pre-download models (optional)
npx @ostanlabs/md-retriever download-models

# Or set custom model path
export MSRL_MODEL_PATH=/path/to/models/bge-m3/model.onnx
```

## Quick Start

```typescript
import { MsrlEngine, type MsrlConfig } from '@ostanlabs/md-retriever';

// 1. Create engine with vault path
const engine = await MsrlEngine.create({
  vaultRoot: '/path/to/obsidian/vault',
});

// 2. Search
const { results } = await engine.query({
  query: 'How does authentication work?',
  topK: 5,
  maxExcerptChars: 2000,
});

// 3. Use results
for (const result of results) {
  console.log(`${result.docUri} → ${result.headingPath}`);
  console.log(`Score: ${result.score} (vector: ${result.vectorScore}, bm25: ${result.bm25Score})`);
  console.log(`Excerpt: ${result.excerpt}`);
  console.log(`Location: chars ${result.startChar}-${result.endChar}`);
}

// 4. Cleanup
await engine.shutdown();
```

## API Reference

### `MsrlEngine`

The main entry point for all operations.

```typescript
class MsrlEngine {
  // Create and initialize engine
  static async create(config: MsrlConfig): Promise<MsrlEngine>;

  // Hybrid search
  async query(params: QueryParams): Promise<QueryResult>;

  // Trigger reindex
  async reindex(params: ReindexParams): Promise<ReindexResult>;

  // Get index status
  getStatus(): IndexStatus;

  // Toggle file watcher
  async setWatch(params: WatchParams): Promise<WatchResult>;

  // Clean shutdown
  async shutdown(): Promise<void>;
}
```

### `QueryParams`

```typescript
interface QueryParams {
  query: string;                    // Search query text
  topK?: number;                    // Max results (default: 8, max: 50)
  maxExcerptChars?: number;         // Max excerpt length (default: 4000)
  filters?: {
    docUriPrefix?: string;          // Filter by path prefix
    docUris?: string[];             // Filter by specific docs
    headingPathContains?: string;   // Filter by heading path substring
  };
  debug?: {
    includeShardsSearched?: boolean;
  };
}
```

### `SearchResult`

```typescript
interface SearchResult {
  docUri: string;               // "notes/daily/2024-01-15.md"
  headingPath: string;          // "Root → Section → Subsection"
  startChar: number;            // Start offset in normalized text
  endChar: number;              // End offset (exclusive)
  excerpt: string;              // Text content (may be truncated)
  excerptTruncated: boolean;    // True if truncated to maxExcerptChars
  score: number;                // Final hybrid score (0-1)
  vectorScore: number;          // Cosine similarity component
  bm25Score: number;            // BM25 component (normalized)
}
```

### `MsrlConfig`

```typescript
interface MsrlConfig {
  vaultRoot: string;            // Required: path to Obsidian vault

  // Optional with defaults:
  snapshotDir?: string;         // Default: "{vaultRoot}/.msrl"
  embedding?: {
    modelPath?: string;         // Default: "~/.msrl/models/bge-m3/model.onnx"
    numThreads?: number;        // Default: 4
    batchSize?: number;         // Default: 32
  };
  chunking?: {
    targetMinTokens?: number;   // Default: 600
    targetMaxTokens?: number;   // Default: 1000
    overlapTokens?: number;     // Default: 100
  };
  watcher?: {
    enabled?: boolean;          // Default: true
    debounceMs?: number;        // Default: 2000
  };
  logLevel?: 'debug' | 'info' | 'warn' | 'error';  // Default: 'info'
}
```

## MCP Server Integration

MSRL is designed to be wrapped by an MCP server. Here's how to integrate it:

### 1. Create MCP Tool Handlers

```typescript
// src/tools/msrl-tools.ts
import { MsrlEngine, MsrlError } from '@ostanlabs/md-retriever';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let engine: MsrlEngine | null = null;

async function getEngine(): Promise<MsrlEngine> {
  if (!engine) {
    engine = await MsrlEngine.create({
      vaultRoot: process.env.OBSIDIAN_VAULT_PATH!,
    });
  }
  return engine;
}

// Tool definitions
export const msrlQueryDefinition = {
  name: 'msrl.query',
  description: 'Hybrid search over vault Markdown files.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Search query' },
      top_k: { type: 'integer', default: 8 },
      max_excerpt_chars: { type: 'integer', default: 4000 },
      filters: {
        type: 'object',
        properties: {
          doc_uri_prefix: { type: 'string' },
          doc_uris: { type: 'array', items: { type: 'string' } },
          heading_path_contains: { type: 'string' },
        },
      },
    },
  },
};

export async function handleMsrlQuery(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const eng = await getEngine();
    const result = await eng.query({
      query: args.query as string,
      topK: args.top_k as number,
      maxExcerptChars: args.max_excerpt_chars as number,
      filters: args.filters ? {
        docUriPrefix: (args.filters as any).doc_uri_prefix,
        docUris: (args.filters as any).doc_uris,
        headingPathContains: (args.filters as any).heading_path_contains,
      } : undefined,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof MsrlError) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ code: err.code, message: err.message }) }],
      };
    }
    throw err;
  }
}
```

### 2. Register Tools with MCP Server

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { msrlQueryDefinition, handleMsrlQuery } from './tools/msrl-tools.js';

const server = new Server({ name: 'obsidian-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [msrlQueryDefinition, /* other tools */],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case 'msrl.query':
      return handleMsrlQuery(request.params.arguments ?? {});
    // ... other tools
  }
});
```

## Agent Integration

When using MSRL with an AI agent (Claude, GPT, etc.), the agent can:

1. **Search for information**: Use `msrl.query` to find relevant content
2. **Get exact locations**: Use `startChar`/`endChar` to reference specific text
3. **Navigate by heading**: Use `headingPath` to understand document structure
4. **Filter by scope**: Use `doc_uri_prefix` to search within specific folders

### Example Agent Prompt

```
You have access to an Obsidian vault via the msrl.query tool. When searching:
- Use specific keywords from the user's question
- Filter by doc_uri_prefix if the user mentions a folder
- The headingPath shows the document structure (e.g., "Notes → Projects → Auth")
- The excerpt contains the actual text; startChar/endChar are byte offsets
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         MsrlEngine                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Parser    │  │  Embedding  │  │   Vector Index      │ │
│  │  (Markdown  │  │  (bge-m3    │  │  (FAISS IVFPQ +     │ │
│  │   → Tree    │  │   ONNX)     │  │   HNSW outline)     │ │
│  │   → Chunks) │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Store     │  │  Retrieval  │  │   Lifecycle         │ │
│  │  (SQLite    │  │  (Hybrid    │  │  (Snapshots +       │ │
│  │   + FTS5)   │  │   scoring)  │  │   File watcher)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Performance

| Operation | Target | Notes |
|-----------|--------|-------|
| Query (p50) | < 80ms | Warm cache |
| Query (p95) | < 300ms | Cold shard load |
| Full index (1K docs) | < 5 min | First-time build |
| Incremental (1 file) | < 1s | File watcher triggered |
| Memory (idle) | < 2GB | Watcher only |
| Memory (query) | < 8GB | 16 cached shards |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MSRL_VAULT_ROOT` | (required) | Path to Obsidian vault |
| `MSRL_SNAPSHOT_DIR` | `{vault}/.msrl` | Snapshot storage location |
| `MSRL_MODEL_PATH` | `~/.msrl/models/bge-m3/model.onnx` | ONNX model path |
| `MSRL_EMBEDDING_THREADS` | `4` | ONNX inference threads |
| `MSRL_WATCHER_ENABLED` | `true` | Auto-start file watcher |
| `MSRL_WATCHER_DEBOUNCE_MS` | `2000` | Watcher debounce delay |
| `MSRL_LOG_LEVEL` | `info` | Log verbosity |

## Error Handling

MSRL throws `MsrlError` with typed error codes:

| Code | Description |
|------|-------------|
| `INVALID_ARGUMENT` | Invalid input parameter |
| `NOT_FOUND` | Document or heading not found |
| `NOT_INDEXED` | No snapshot loaded yet |
| `INDEX_BUSY` | Reindex already in progress |
| `INDEX_CORRUPT` | Snapshot validation failed |
| `IO_ERROR` | File read/write failed |
| `MODEL_DOWNLOAD_FAILED` | Model download failed |
| `INTERNAL` | Unexpected error |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT © Ostan Labs
