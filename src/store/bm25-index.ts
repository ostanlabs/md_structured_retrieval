/**
 * BM25 Index - FTS5 wrapper for BM25 lexical search
 *
 * Uses SQLite FTS5 with contentless mode for BM25 scoring.
 * Text is indexed but not stored - excerpts are read from original files.
 */

import { MetadataStore } from './metadata-store.js';

export interface Bm25Result {
  leafId: string;
  docUri: string;
  headingPath: string;
  bm25Score: number; // raw FTS5 rank (negative, lower = more relevant)
  normalizedScore: number; // normalized to 0-1 range
}

export interface FtsEntry {
  leafId: string;
  docUri: string;
  headingPath: string;
  text: string;
}

export class Bm25Index {
  private store: MetadataStore;

  constructor(store: MetadataStore) {
    this.store = store;
  }

  /**
   * Insert entries into FTS5 index.
   * Uses external content table (fts_content) for storage and deletion support.
   */
  insertFtsEntries(entries: FtsEntry[]): void {
    const db = (this.store as any).db;
    // Insert into content table first
    const contentStmt = db.prepare(`INSERT INTO fts_content(leaf_id, text) VALUES (?, ?)`);
    // Then sync to FTS5 index
    const ftsStmt = db.prepare(`INSERT INTO leaves_fts(rowid, text) VALUES (?, ?)`);

    const insertMany = db.transaction((entries: FtsEntry[]) => {
      for (const e of entries) {
        const result = contentStmt.run(e.leafId, e.text);
        const rowid = result.lastInsertRowid;
        ftsStmt.run(rowid, e.text);
      }
    });
    insertMany(entries);
  }

  /**
   * Delete entries from FTS5 index.
   * Uses external content table for proper deletion support.
   */
  deleteFtsEntries(leafIds: string[]): void {
    if (leafIds.length === 0) return;

    const db = (this.store as any).db;
    const placeholders = leafIds.map(() => '?').join(',');

    // Get rowids and text from content table for FTS5 deletion
    const getRowsStmt = db.prepare(`
      SELECT rowid, text FROM fts_content WHERE leaf_id IN (${placeholders})
    `);
    const rows = getRowsStmt.all(...leafIds) as { rowid: number; text: string }[];

    if (rows.length === 0) return;

    // Delete from FTS5 index (requires rowid and original text for external content)
    const deleteFtsStmt = db.prepare(`
      INSERT INTO leaves_fts(leaves_fts, rowid, text) VALUES ('delete', ?, ?)
    `);

    // Delete from content table
    const deleteContentStmt = db.prepare(`
      DELETE FROM fts_content WHERE leaf_id IN (${placeholders})
    `);

    const deleteMany = db.transaction(() => {
      for (const row of rows) {
        deleteFtsStmt.run(row.rowid, row.text);
      }
      deleteContentStmt.run(...leafIds);
    });
    deleteMany();
  }

  /**
   * Run BM25 search over FTS5.
   * Returns results sorted by BM25 relevance.
   *
   * FTS5 rank() returns negative values (more negative = more relevant).
   * Normalization: normalizedScore = -rank / maxAbsRank (across result set).
   */
  search(query: string, limit: number): Bm25Result[] {
    const db = (this.store as any).db;

    // Escape special FTS5 characters and build OR query for better recall
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/['"]/g, ''));

    if (terms.length === 0) return [];

    // Build FTS5 query: term1 OR term2 OR term3
    const ftsQuery = terms.join(' OR ');

    // Use fts_content table to map FTS5 rowids to leaf_ids
    const stmt = db.prepare(`
      SELECT c.leaf_id, d.doc_uri, n.heading_path, bm25(leaves_fts) as rank
      FROM leaves_fts
      JOIN fts_content c ON leaves_fts.rowid = c.rowid
      JOIN leaves l ON c.leaf_id = l.leaf_id
      JOIN docs d ON l.doc_id = d.doc_id
      JOIN nodes n ON l.node_id = n.node_id
      WHERE leaves_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, limit) as {
      leaf_id: string;
      doc_uri: string;
      heading_path: string;
      rank: number;
    }[];

    if (rows.length === 0) return [];

    // Find max absolute rank for normalization
    // FTS5 rank is negative (more negative = more relevant)
    const maxAbsRank = Math.max(...rows.map((r) => Math.abs(r.rank)));

    return rows.map((r) => ({
      leafId: r.leaf_id,
      docUri: r.doc_uri,
      headingPath: r.heading_path,
      bm25Score: r.rank,
      normalizedScore: maxAbsRank > 0 ? Math.abs(r.rank) / maxAbsRank : 1,
    }));
  }

  /**
   * Run BM25 search restricted to specific shard IDs.
   * Uses a JOIN with leaves table filtered by shard_id.
   */
  searchInShards(query: string, shardIds: number[], limit: number): Bm25Result[] {
    if (shardIds.length === 0) return [];

    const db = (this.store as any).db;

    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/['"]/g, ''));

    if (terms.length === 0) return [];

    const ftsQuery = terms.join(' OR ');
    const placeholders = shardIds.map(() => '?').join(',');

    const stmt = db.prepare(`
      SELECT c.leaf_id, d.doc_uri, n.heading_path, bm25(leaves_fts) as rank
      FROM leaves_fts
      JOIN fts_content c ON leaves_fts.rowid = c.rowid
      JOIN leaves l ON c.leaf_id = l.leaf_id
      JOIN docs d ON l.doc_id = d.doc_id
      JOIN nodes n ON l.node_id = n.node_id
      WHERE leaves_fts MATCH ?
        AND l.shard_id IN (${placeholders})
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, ...shardIds, limit) as {
      leaf_id: string;
      doc_uri: string;
      heading_path: string;
      rank: number;
    }[];

    if (rows.length === 0) return [];

    const maxAbsRank = Math.max(...rows.map((r) => Math.abs(r.rank)));

    return rows.map((r) => ({
      leafId: r.leaf_id,
      docUri: r.doc_uri,
      headingPath: r.heading_path,
      bm25Score: r.rank,
      normalizedScore: maxAbsRank > 0 ? Math.abs(r.rank) / maxAbsRank : 1,
    }));
  }
}

