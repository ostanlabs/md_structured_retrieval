/**
 * MetadataStore - SQLite wrapper for MSRL metadata
 *
 * Stores document, node, and leaf metadata with embedding cache.
 * Uses WAL mode for concurrent reads and FTS5 for BM25 search.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Schema DDL embedded directly to avoid file path issues at runtime
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS docs (
  doc_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uri    TEXT NOT NULL UNIQUE,
  mtime      REAL NOT NULL,
  size       INTEGER NOT NULL,
  hash       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_docs_uri ON docs(doc_uri);

CREATE TABLE IF NOT EXISTS nodes (
  node_id       TEXT PRIMARY KEY,
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
  leaf_id    TEXT PRIMARY KEY,
  doc_id     INTEGER NOT NULL REFERENCES docs(doc_id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  start_char INTEGER NOT NULL,
  end_char   INTEGER NOT NULL,
  text_hash  TEXT NOT NULL,
  shard_id   INTEGER NOT NULL,
  embedding  BLOB
);

CREATE INDEX IF NOT EXISTS idx_leaves_doc_id ON leaves(doc_id);
CREATE INDEX IF NOT EXISTS idx_leaves_node_id ON leaves(node_id);
CREATE INDEX IF NOT EXISTS idx_leaves_shard_id ON leaves(shard_id);

-- FTS5 content table - stores text for indexing and deletion support
CREATE TABLE IF NOT EXISTS fts_content (
  rowid     INTEGER PRIMARY KEY,
  leaf_id   TEXT NOT NULL UNIQUE,
  text      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fts_content_leaf_id ON fts_content(leaf_id);

-- FTS5 index using external content table
CREATE VIRTUAL TABLE IF NOT EXISTS leaves_fts USING fts5(
  text,
  content='fts_content',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Row types
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
  embedding: Buffer | null;
}

export interface LeafRowWithEmbedding extends LeafRow {
  embedding: Buffer | null;
}

export class MetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Run schema DDL. Idempotent. */
  initialize(): void {
    // Remove SQL comments first, then split by semicolons
    const schemaWithoutComments = SCHEMA_DDL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    const statements = schemaWithoutComments
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      this.db.exec(stmt);
    }
  }

  // --- Docs ---
  upsertDoc(doc: { docUri: string; mtime: number; size: number; hash: string }): number {
    const stmt = this.db.prepare(`
      INSERT INTO docs (doc_uri, mtime, size, hash)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(doc_uri) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        hash = excluded.hash
    `);
    const result = stmt.run(doc.docUri, doc.mtime, doc.size, doc.hash);
    return result.lastInsertRowid as number;
  }

  getDoc(docUri: string): DocRow | null {
    const stmt = this.db.prepare(`
      SELECT doc_id as docId, doc_uri as docUri, mtime, size, hash
      FROM docs WHERE doc_uri = ?
    `);
    return (stmt.get(docUri) as DocRow) || null;
  }

  deleteDoc(docUri: string): void {
    const stmt = this.db.prepare('DELETE FROM docs WHERE doc_uri = ?');
    stmt.run(docUri);
  }

  listDocs(): DocRow[] {
    const stmt = this.db.prepare(`
      SELECT doc_id as docId, doc_uri as docUri, mtime, size, hash FROM docs
    `);
    return stmt.all() as DocRow[];
  }

  getChangedDocs(knownDocs: Map<string, { mtime: number; hash: string }>): {
    added: string[];
    modified: string[];
    deleted: string[];
  } {
    const currentDocs = this.listDocs();
    const currentUris = new Set(currentDocs.map((d) => d.docUri));
    const knownUris = new Set(knownDocs.keys());

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    // Find added and modified
    for (const doc of currentDocs) {
      if (!knownUris.has(doc.docUri)) {
        added.push(doc.docUri);
      } else {
        const known = knownDocs.get(doc.docUri)!;
        if (doc.mtime !== known.mtime || doc.hash !== known.hash) {
          modified.push(doc.docUri);
        }
      }
    }

    // Find deleted
    for (const uri of knownUris) {
      if (!currentUris.has(uri)) {
        deleted.push(uri);
      }
    }

    return { added, modified, deleted };
  }

  // --- Nodes ---
  insertNodes(nodes: NodeRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (node_id, doc_id, level, heading_path, start_char, end_char, shard_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((nodes: NodeRow[]) => {
      for (const n of nodes) {
        stmt.run(n.nodeId, n.docId, n.level, n.headingPath, n.startChar, n.endChar, n.shardId);
      }
    });
    insertMany(nodes);
  }

  getNodesByDoc(docId: number): NodeRow[] {
    const stmt = this.db.prepare(`
      SELECT node_id as nodeId, doc_id as docId, level, heading_path as headingPath,
             start_char as startChar, end_char as endChar, shard_id as shardId
      FROM nodes WHERE doc_id = ?
    `);
    return stmt.all(docId) as NodeRow[];
  }

  getNodesByShardIds(shardIds: number[]): NodeRow[] {
    if (shardIds.length === 0) return [];
    const placeholders = shardIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT node_id as nodeId, doc_id as docId, level, heading_path as headingPath,
             start_char as startChar, end_char as endChar, shard_id as shardId
      FROM nodes WHERE shard_id IN (${placeholders})
    `);
    return stmt.all(...shardIds) as NodeRow[];
  }

  // --- Leaves ---
  insertLeaves(leaves: LeafRow[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO leaves (leaf_id, doc_id, node_id, start_char, end_char, text_hash, shard_id, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((leaves: LeafRow[]) => {
      for (const l of leaves) {
        stmt.run(l.leafId, l.docId, l.nodeId, l.startChar, l.endChar, l.textHash, l.shardId, l.embedding);
      }
    });
    insertMany(leaves);
  }

  getLeavesByDoc(docId: number): LeafRow[] {
    const stmt = this.db.prepare(`
      SELECT leaf_id as leafId, doc_id as docId, node_id as nodeId,
             start_char as startChar, end_char as endChar, text_hash as textHash,
             shard_id as shardId, embedding
      FROM leaves WHERE doc_id = ?
    `);
    return stmt.all(docId) as LeafRow[];
  }

  getLeavesByShardIds(shardIds: number[]): LeafRow[] {
    if (shardIds.length === 0) return [];
    const placeholders = shardIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT leaf_id as leafId, doc_id as docId, node_id as nodeId,
             start_char as startChar, end_char as endChar, text_hash as textHash,
             shard_id as shardId, embedding
      FROM leaves WHERE shard_id IN (${placeholders})
    `);
    return stmt.all(...shardIds) as LeafRow[];
  }

  getLeavesByShard(shardId: number): LeafRowWithEmbedding[] {
    const stmt = this.db.prepare(`
      SELECT leaf_id as leafId, doc_id as docId, node_id as nodeId,
             start_char as startChar, end_char as endChar, text_hash as textHash,
             shard_id as shardId, embedding
      FROM leaves WHERE shard_id = ?
    `);
    return stmt.all(shardId) as LeafRowWithEmbedding[];
  }

  getLeafById(leafId: string): LeafRow | null {
    const stmt = this.db.prepare(`
      SELECT leaf_id as leafId, doc_id as docId, node_id as nodeId,
             start_char as startChar, end_char as endChar, text_hash as textHash,
             shard_id as shardId, embedding
      FROM leaves WHERE leaf_id = ?
    `);
    return (stmt.get(leafId) as LeafRow) || null;
  }

  getLeafWithEmbedding(leafId: string): LeafRowWithEmbedding | null {
    return this.getLeafById(leafId) as LeafRowWithEmbedding | null;
  }

  // --- Embedding Cache ---
  updateEmbedding(leafId: string, embedding: Buffer): void {
    const stmt = this.db.prepare('UPDATE leaves SET embedding = ? WHERE leaf_id = ?');
    stmt.run(embedding, leafId);
  }

  // --- Bulk ---
  deleteDocCascade(docUri: string): void {
    // Foreign keys with ON DELETE CASCADE handle nodes and leaves
    this.deleteDoc(docUri);
  }

  // --- Integrity ---
  checkIntegrity(): { ok: boolean; errors: string[] } {
    const result = this.db.pragma('integrity_check') as { integrity_check: string }[];
    const errors = result.filter((r) => r.integrity_check !== 'ok').map((r) => r.integrity_check);
    return { ok: errors.length === 0, errors };
  }

  // --- Stats ---
  getCounts(): { docs: number; nodes: number; leaves: number } {
    const docs = (this.db.prepare('SELECT COUNT(*) as count FROM docs').get() as { count: number }).count;
    const nodes = (this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
    const leaves = (this.db.prepare('SELECT COUNT(*) as count FROM leaves').get() as { count: number }).count;
    return { docs, nodes, leaves };
  }

  close(): void {
    this.db.close();
  }
}

