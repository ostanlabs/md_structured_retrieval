-- MSRL Metadata Store Schema
-- SQLite with WAL mode and FTS5 for BM25 search

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Documents table: one row per indexed .md file
CREATE TABLE IF NOT EXISTS docs (
  doc_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uri    TEXT NOT NULL UNIQUE,
  mtime      REAL NOT NULL,          -- Unix timestamp (fractional seconds)
  size       INTEGER NOT NULL,       -- file size in bytes
  hash       TEXT NOT NULL           -- sha256 of normalized content
);

CREATE INDEX IF NOT EXISTS idx_docs_uri ON docs(doc_uri);

-- Nodes table: heading tree nodes
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

-- Leaves table: text chunks (leaf nodes in heading tree)
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
-- Excerpt retrieval reads from original .md files using start_char/end_char
CREATE VIRTUAL TABLE IF NOT EXISTS leaves_fts USING fts5(
  leaf_id,
  doc_uri,
  heading_path,
  text,
  content='',                    -- Contentless: index only, no text storage
  tokenize='porter unicode61'
);

-- Metadata table for snapshot info
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

