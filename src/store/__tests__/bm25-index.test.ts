/**
 * BM25 Index Tests
 *
 * TDD: These tests define the expected behavior of the FTS5 BM25 search wrapper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bm25Index, Bm25Result } from '../bm25-index.js';
import { MetadataStore } from '../metadata-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Bm25Index', () => {
  let store: MetadataStore;
  let bm25: Bm25Index;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-bm25-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new MetadataStore(dbPath);
    store.initialize();
    bm25 = new Bm25Index(store);
  });

  afterEach(() => {
    store.close();
    const tmpDir = path.dirname(dbPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper to insert test data
  function insertTestDoc(docUri: string, leaves: { leafId: string; headingPath: string; text: string }[]) {
    const docId = store.upsertDoc({ docUri, mtime: Date.now(), size: 1000, hash: 'test' });
    store.insertNodes([
      { nodeId: `node-${docUri}`, docId, level: 0, headingPath: '', startChar: 0, endChar: 1000, shardId: 0 },
    ]);
    const leafRows = leaves.map((l, i) => ({
      leafId: l.leafId,
      docId,
      nodeId: `node-${docUri}`,
      startChar: i * 100,
      endChar: (i + 1) * 100,
      textHash: `hash-${l.leafId}`,
      shardId: 0,
      embedding: null,
    }));
    store.insertLeaves(leafRows);

    // Insert into FTS5
    bm25.insertFtsEntries(
      leaves.map((l) => ({
        leafId: l.leafId,
        docUri,
        headingPath: l.headingPath,
        text: l.text,
      }))
    );
  }

  describe('insertFtsEntries()', () => {
    it('should insert entries into FTS5 index', () => {
      insertTestDoc('test.md', [
        { leafId: 'l1', headingPath: 'Intro', text: 'Hello world' },
      ]);

      const results = bm25.search('hello', 10);
      expect(results.length).toBe(1);
      expect(results[0]!.leafId).toBe('l1');
    });
  });

  describe('search()', () => {
    beforeEach(() => {
      insertTestDoc('kubernetes.md', [
        { leafId: 'k1', headingPath: 'Overview', text: 'Kubernetes is a container orchestration platform' },
        { leafId: 'k2', headingPath: 'Pods', text: 'A pod is the smallest deployable unit in Kubernetes' },
        { leafId: 'k3', headingPath: 'Services', text: 'Services provide networking for pods' },
      ]);
      insertTestDoc('docker.md', [
        { leafId: 'd1', headingPath: 'Intro', text: 'Docker is a container runtime' },
        { leafId: 'd2', headingPath: 'Images', text: 'Docker images are built from Dockerfiles' },
      ]);
    });

    it('should return matching documents', () => {
      const results = bm25.search('kubernetes', 10);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.leafId).sort()).toEqual(['k1', 'k2']);
    });

    it('should return results sorted by relevance', () => {
      const results = bm25.search('container', 10);
      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by score (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.normalizedScore).toBeGreaterThanOrEqual(results[i]!.normalizedScore);
      }
    });

    it('should respect limit parameter', () => {
      const results = bm25.search('container', 1);
      expect(results.length).toBe(1);
    });

    it('should return empty array for no matches', () => {
      const results = bm25.search('nonexistent', 10);
      expect(results).toEqual([]);
    });

    it('should include docUri and headingPath in results', () => {
      const results = bm25.search('kubernetes', 10);
      expect(results[0]!.docUri).toBe('kubernetes.md');
      expect(results[0]!.headingPath).toBeDefined();
    });
  });

  describe('score normalization', () => {
    beforeEach(() => {
      insertTestDoc('test.md', [
        { leafId: 'l1', headingPath: 'A', text: 'apple apple apple' },
        { leafId: 'l2', headingPath: 'B', text: 'apple banana' },
        { leafId: 'l3', headingPath: 'C', text: 'banana cherry' },
      ]);
    });

    it('should normalize scores to 0-1 range', () => {
      const results = bm25.search('apple', 10);
      for (const r of results) {
        expect(r.normalizedScore).toBeGreaterThanOrEqual(0);
        expect(r.normalizedScore).toBeLessThanOrEqual(1);
      }
    });

    it('should give highest normalized score to best match', () => {
      const results = bm25.search('apple', 10);
      expect(results[0]!.normalizedScore).toBe(1); // Best match gets 1.0
    });
  });

  describe('deleteFtsEntries()', () => {
    it('should remove entries from FTS5 index', () => {
      insertTestDoc('test.md', [
        { leafId: 'l1', headingPath: 'A', text: 'hello world' },
        { leafId: 'l2', headingPath: 'B', text: 'hello there' },
      ]);

      let results = bm25.search('hello', 10);
      expect(results.length).toBe(2);

      bm25.deleteFtsEntries(['l1']);

      results = bm25.search('hello', 10);
      expect(results.length).toBe(1);
      expect(results[0]!.leafId).toBe('l2');
    });
  });
});

