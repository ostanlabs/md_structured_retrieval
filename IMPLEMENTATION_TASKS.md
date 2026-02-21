# MSRL Implementation Tasks

This document breaks down the MSRL implementation into actionable tasks organized by phase.

**Estimated total effort:** 4-6 weeks for a single developer

---

## Phase 0: Project Setup (1-2 days)

### P0.1 Initialize Package Structure
- [ ] Create `package.json` with dependencies
- [ ] Create `tsconfig.json`
- [ ] Create `vitest.config.ts`
- [ ] Set up ESLint configuration
- [ ] Create `.gitignore` (node_modules, dist, models/, .msrl/)
- [ ] Create `src/index.ts` barrel export (empty initially)

### P0.2 Install Dependencies
- [ ] `npm install onnxruntime-node faiss-node better-sqlite3 chokidar zod @xenova/transformers`
- [ ] `npm install -D @types/better-sqlite3 @types/node vitest typescript tsx`
- [ ] Verify all native modules compile correctly

### P0.3 Create Type Foundations
- [ ] Create `src/types.ts` with all interfaces from spec:
  - HeadingNode, HeadingTree, Chunk
  - SearchResult, QueryResult
  - EmbeddingResult, VectorSearchResult
  - DocRow, NodeRow, LeafRow
  - MsrlError, MsrlErrorCode
- [ ] Create `src/config.ts` with MsrlConfig Zod schema

---

## Phase 1: Markdown Parser & Chunker (3-5 days)

### P1.1 Fence Detector
- [ ] Create `src/parser/fence-detector.ts`
- [ ] Implement `detect(text): FencedRegion[]`
- [ ] Implement `isInsideFence(offset, regions): boolean`
- [ ] Write tests: basic fences, nested fences, language tags

### P1.2 Markdown Parser
- [ ] Create `src/parser/markdown-parser.ts`
- [ ] Implement `normalize(raw): string` (line endings, BOM, trailing newline)
- [ ] Implement `parseHeadings(docUri, text): HeadingTree`
- [ ] Handle ATX headings (#-######)
- [ ] Skip headings inside fenced blocks
- [ ] Build heading path with ` → ` separator
- [ ] Calculate startChar/endChar offsets
- [ ] Write tests: basic tree, nested headings, fenced blocks, edge cases

### P1.3 Chunker
- [ ] Create `src/parser/chunker.ts`
- [ ] Implement paragraph splitting (respecting fences)
- [ ] Implement greedy chunk accumulation
- [ ] Implement overlap with paragraph-word fallback
- [ ] Implement small chunk merging
- [ ] Handle atomic oversized fenced blocks
- [ ] Write tests: size bounds, fence integrity, overlap, determinism

### P1.4 Shard Router
- [ ] Create `src/vector/shard-router.ts`
- [ ] Implement FNV-1a hash
- [ ] Implement `getShardId(docUri): number`
- [ ] Write tests: distribution uniformity, determinism

### P1.5 doc_uri Utilities
- [ ] Create `src/utils/doc-uri.ts`
- [ ] Implement `toDocUri(absolutePath, vaultRoot): string`
- [ ] Implement `toAbsolutePath(docUri, vaultRoot): string`
- [ ] Write tests: cross-platform paths, special characters

---

## Phase 2: Embedding Provider & Vector Index (5-7 days)

### P2.1 Model Downloader
- [ ] Create `src/embedding/model-downloader.ts`
- [ ] Implement HuggingFace download with progress callback
- [ ] Implement SHA256 verification
- [ ] Implement `ensureModelDownloaded(modelName, targetDir)`
- [ ] Write tests: download, hash verification, corruption handling

### P2.2 Tokenizer
- [ ] Create `src/embedding/tokenizer.ts`
- [ ] Use `@xenova/transformers` for tokenization
- [ ] Implement `encode(text): number[]`
- [ ] Implement `countTokens(text): number`
- [ ] Write tests: token counts, special characters, long texts

### P2.3 ONNX Embedding Provider
- [ ] Create `src/embedding/embedding-provider.ts` (interface)
- [ ] Create `src/embedding/onnx-bge-m3-provider.ts`
- [ ] Implement ONNX session initialization
- [ ] Implement `embed(text): Float32Array`
- [ ] Implement `embedBatch(texts): Float32Array[]`
- [ ] Implement L2 normalization
- [ ] Write tests: embedding dimensions, normalization, batch consistency

### P2.4 FAISS Shard Index
- [ ] Create `src/vector/vector-index.ts` (interface)
- [ ] Create `src/vector/faiss-shard-index.ts`
- [ ] Implement IndexFlatIP for small shards (<1000 vectors)
- [ ] Implement IVFPQ for large shards (≥1000 vectors)
- [ ] Implement `add(ids, vectors)`
- [ ] Implement `search(query, topK): VectorSearchResult[]`
- [ ] Implement `train(vectors)` for IVFPQ
- [ ] Implement `save(path)` and `load(path)`
- [ ] Write tests: add/search, training threshold, persistence

### P2.5 HNSW Outline Index
- [ ] Create `src/vector/hnsw-outline-index.ts`
- [ ] Implement HNSW index for node embeddings
- [ ] Implement `add(nodeIds, vectors)`
- [ ] Implement `search(query, topK): string[]` (returns nodeIds)
- [ ] Write tests: routing accuracy, persistence

### P2.6 Node Embedding (MMR)
- [ ] Create `src/vector/node-embedding.ts`
- [ ] Implement MMR representative selection
- [ ] Implement adaptive k calculation
- [ ] Implement `computeNodeEmbedding(leafEmbeddings): Float32Array`
- [ ] Write tests: representative diversity, edge cases (1 leaf, many leaves)

---

## Phase 3: Metadata Store & BM25 (3-4 days)

### P3.1 SQLite Schema
- [ ] Create `src/store/schema.sql`
- [ ] Define `docs` table (doc_uri, content_hash, mtime_ms, title)
- [ ] Define `nodes` table (node_id, doc_uri, heading_path, level, start_char, end_char)
- [ ] Define `leaves` table (leaf_id, node_id, doc_uri, shard_id, start_char, end_char, embedding)
- [ ] Define `leaves_fts` contentless FTS5 table
- [ ] Define `meta` table (key, value)
- [ ] Add indexes for common queries

### P3.2 Metadata Store
- [ ] Create `src/store/metadata-store.ts`
- [ ] Implement connection management (WAL mode, foreign keys)
- [ ] Implement `initSchema()`
- [ ] Implement CRUD for docs, nodes, leaves
- [ ] Implement `getLeafEmbedding(leafId): Float32Array | null`
- [ ] Implement `getDocByUri(docUri): DocRow | null`
- [ ] Implement `getNodesByDoc(docUri): NodeRow[]`
- [ ] Implement `getLeavesByNode(nodeId): LeafRow[]`
- [ ] Implement `getLeavesByShard(shardId): LeafRow[]`
- [ ] Write tests: CRUD operations, embedding storage/retrieval

### P3.3 BM25 Index
- [ ] Create `src/store/bm25-index.ts`
- [ ] Implement `indexLeaf(leafId, text)`
- [ ] Implement `removeLeaf(leafId)`
- [ ] Implement `search(query, topK): BM25Result[]`
- [ ] Implement BM25 score normalization (0-1 range)
- [ ] Write tests: indexing, search, score normalization

---

## Phase 4: Hybrid Retrieval Pipeline (4-5 days)

### P4.1 Hybrid Scorer
- [ ] Create `src/retrieval/hybrid-scorer.ts`
- [ ] Implement weighted fusion: `0.75 * vectorScore + 0.25 * bm25Score`
- [ ] Implement missing score handling (vector from cache, BM25=0)
- [ ] Implement tie-breaking by docUri + startChar
- [ ] Write tests: score calculation, missing scores, tie-breaking

### P4.2 Span Merger
- [ ] Create `src/retrieval/span-merger.ts`
- [ ] Implement adjacent span detection (within 200 chars)
- [ ] Implement overlapping span merging
- [ ] Implement score aggregation for merged spans
- [ ] Write tests: adjacent, overlapping, non-overlapping

### P4.3 Excerpt Extractor
- [ ] Create `src/retrieval/excerpt-extractor.ts`
- [ ] Implement file reading with offset extraction
- [ ] Implement truncation with `excerptTruncated` flag
- [ ] Implement word-boundary truncation
- [ ] Write tests: exact extraction, truncation, edge cases

### P4.4 Retrieval Pipeline
- [ ] Create `src/retrieval/retrieval-pipeline.ts`
- [ ] Implement outline routing (HNSW → shard selection)
- [ ] Implement parallel shard search
- [ ] Implement BM25 search
- [ ] Implement result merging and scoring
- [ ] Implement filter application (docUriPrefix, docUris, headingPathContains)
- [ ] Implement span merging
- [ ] Implement excerpt extraction
- [ ] Write integration tests: full pipeline, filters, edge cases

---

## Phase 5: Snapshot & Lifecycle Management (4-5 days)

### P5.1 File Scanner
- [ ] Create `src/lifecycle/file-scanner.ts`
- [ ] Implement vault scanning (recursive .md discovery)
- [ ] Implement content hash calculation (SHA256)
- [ ] Implement change detection (new, modified, deleted)
- [ ] Implement `.msrl/` and `.obsidian/` exclusion
- [ ] Write tests: scanning, change detection, exclusions

### P5.2 Snapshot Builder
- [ ] Create `src/lifecycle/snapshot-builder.ts`
- [ ] Implement full build orchestration
- [ ] Implement incremental build (changed files only)
- [ ] Implement embedding caching (reuse from SQLite)
- [ ] Implement shard rebuild with cached embeddings
- [ ] Implement progress reporting
- [ ] Write tests: full build, incremental build, caching

### P5.3 Snapshot Manager
- [ ] Create `src/lifecycle/snapshot-manager.ts`
- [ ] Implement snapshot directory structure
- [ ] Implement atomic activation (rename)
- [ ] Implement validation (file existence, counts)
- [ ] Implement rollback to previous snapshot
- [ ] Implement cleanup of old snapshots
- [ ] Write tests: activation, validation, rollback

### P5.4 File Watcher
- [ ] Create `src/lifecycle/file-watcher.ts`
- [ ] Implement chokidar wrapper
- [ ] Implement debouncing (configurable, default 2000ms)
- [ ] Implement batch change collection
- [ ] Implement incremental reindex trigger
- [ ] Write tests: debouncing, batch collection, error handling

---

## Phase 6: MsrlEngine & Integration (3-4 days)

### P6.1 MsrlEngine Core
- [ ] Create `src/engine.ts`
- [ ] Implement `MsrlEngine.create(config)` factory
- [ ] Implement component initialization (store, embedding, vector, retrieval)
- [ ] Implement snapshot loading on startup
- [ ] Implement `query(params): QueryResult`
- [ ] Implement `reindex(params): ReindexResult`
- [ ] Implement `getStatus(): IndexStatus`
- [ ] Implement `setWatch(params): WatchResult`
- [ ] Implement `shutdown()` cleanup
- [ ] Implement mutex for concurrent reindex prevention

### P6.2 Error Handling
- [ ] Create `src/errors.ts`
- [ ] Implement MsrlError class with typed codes
- [ ] Implement error details structure for each code
- [ ] Add error wrapping throughout codebase
- [ ] Write tests: error creation, details structure

### P6.3 Logging
- [ ] Create `src/logger.ts`
- [ ] Implement configurable log levels
- [ ] Implement structured logging (JSON format option)
- [ ] Add logging throughout codebase

### P6.4 Public API Export
- [ ] Update `src/index.ts` with all public exports
- [ ] Ensure clean type exports
- [ ] Write API documentation in README

---

## Phase 7: doc.* Tools (Optional, 2-3 days)

### P7.1 Document Validator
- [ ] Create `src/doc/doc-validator.ts`
- [ ] Implement heading path validation
- [ ] Implement offset validation
- [ ] Implement content validation

### P7.2 Document Writer
- [ ] Create `src/doc/doc-writer.ts`
- [ ] Implement `replaceSection(docUri, headingPath, newContent)`
- [ ] Implement `appendToSection(docUri, headingPath, content)`
- [ ] Implement `insertAfterSection(docUri, headingPath, newHeading, content)`
- [ ] Implement atomic file writes
- [ ] Write tests: replace, append, insert, error cases

---

## Phase 8: MCP Server Integration (2-3 days)

### P8.1 Tool Definitions
- [ ] Create MCP tool schemas for:
  - `msrl.query`
  - `msrl.reindex`
  - `msrl.status`
  - `msrl.watch`
  - `doc.replaceSection`
  - `doc.appendToSection`
  - `doc.insertAfterSection`

### P8.2 Tool Handlers
- [ ] Implement handlers for each tool
- [ ] Implement error mapping to MCP error format
- [ ] Implement input validation with Zod

### P8.3 Integration Testing
- [ ] Write end-to-end tests with MCP server
- [ ] Test error scenarios
- [ ] Test concurrent operations

---

## Testing Strategy

### Unit Tests (per module)
- Each module should have `__tests__/` directory
- Use vitest for all tests
- Mock external dependencies (file system, ONNX, FAISS)

### Integration Tests
- Test full pipeline with real files
- Test snapshot lifecycle
- Test concurrent operations

### Performance Tests
- Benchmark query latency (target: p50 < 80ms)
- Benchmark indexing throughput
- Memory profiling

---

## Definition of Done

Each task is complete when:
1. ✅ Code implemented and compiles
2. ✅ Unit tests written and passing
3. ✅ Types exported correctly
4. ✅ Error handling implemented
5. ✅ Logging added where appropriate

---

## Dependencies Between Phases

```
Phase 0 (Setup)
    ↓
Phase 1 (Parser) ──────────────────┐
    ↓                              │
Phase 2 (Embedding/Vector) ←───────┤
    ↓                              │
Phase 3 (Store/BM25) ←─────────────┘
    ↓
Phase 4 (Retrieval)
    ↓
Phase 5 (Snapshot/Lifecycle)
    ↓
Phase 6 (Engine)
    ↓
Phase 7 (doc.* tools) ← Optional
    ↓
Phase 8 (MCP Integration)
```

**Critical path:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P8

Phase 7 (doc.* tools) can be done in parallel with Phase 8 or deferred.

### P2.6 Node Embedding (MMR)
- [ ] Create `src/vector/node-embedding.ts`
- [ ] Implement MMR representative selection
- [ ] Implement adaptive k calculation
- [ ] Implement `computeNodeEmbedding(leafEmbeddings): Float32Array`
- [ ] Write tests: representative diversity, edge cases (1 leaf, many leaves)

