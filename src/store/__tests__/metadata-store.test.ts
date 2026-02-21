/**
 * MetadataStore Tests
 *
 * TDD: These tests define the expected behavior of the SQLite metadata store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetadataStore } from '../metadata-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MetadataStore', () => {
  let store: MetadataStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new MetadataStore(dbPath);
    store.initialize();
  });

  afterEach(() => {
    store.close();
    const tmpDir = path.dirname(dbPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initialize()', () => {
    it('should create all required tables', () => {
      const counts = store.getCounts();
      expect(counts.docs).toBe(0);
      expect(counts.nodes).toBe(0);
      expect(counts.leaves).toBe(0);
    });

    it('should be idempotent', () => {
      store.initialize();
      const counts = store.getCounts();
      expect(counts.docs).toBe(0);
    });
  });

  describe('docs CRUD', () => {
    it('should insert a new doc', () => {
      const docId = store.upsertDoc({
        docUri: 'notes/test.md',
        mtime: 1700000000.123,
        size: 1024,
        hash: 'abc123',
      });
      expect(docId).toBeGreaterThan(0);
      const doc = store.getDoc('notes/test.md');
      expect(doc).not.toBeNull();
      expect(doc!.docUri).toBe('notes/test.md');
      expect(doc!.mtime).toBeCloseTo(1700000000.123, 3);
      expect(doc!.size).toBe(1024);
      expect(doc!.hash).toBe('abc123');
    });

    it('should update existing doc on upsert', () => {
      store.upsertDoc({ docUri: 'notes/test.md', mtime: 1700000000.0, size: 1024, hash: 'abc123' });
      store.upsertDoc({ docUri: 'notes/test.md', mtime: 1700000001.0, size: 2048, hash: 'def456' });
      const doc = store.getDoc('notes/test.md');
      expect(doc!.mtime).toBeCloseTo(1700000001.0, 3);
      expect(doc!.size).toBe(2048);
      expect(doc!.hash).toBe('def456');
      expect(store.getCounts().docs).toBe(1);
    });

    it('should delete a doc', () => {
      store.upsertDoc({ docUri: 'notes/test.md', mtime: 1700000000.0, size: 1024, hash: 'abc123' });
      store.deleteDoc('notes/test.md');
      expect(store.getDoc('notes/test.md')).toBeNull();
    });

    it('should list all docs', () => {
      store.upsertDoc({ docUri: 'a.md', mtime: 1, size: 100, hash: 'a' });
      store.upsertDoc({ docUri: 'b.md', mtime: 2, size: 200, hash: 'b' });
      store.upsertDoc({ docUri: 'c.md', mtime: 3, size: 300, hash: 'c' });
      const docs = store.listDocs();
      expect(docs.length).toBe(3);
      expect(docs.map((d) => d.docUri).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    });
  });

  describe('getChangedDocs()', () => {
    it('should detect added docs', () => {
      store.upsertDoc({ docUri: 'a.md', mtime: 1, size: 100, hash: 'a' });
      store.upsertDoc({ docUri: 'b.md', mtime: 2, size: 200, hash: 'b' });
      const changes = store.getChangedDocs(new Map());
      expect(changes.added.sort()).toEqual(['a.md', 'b.md']);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect modified docs', () => {
      store.upsertDoc({ docUri: 'a.md', mtime: 2, size: 100, hash: 'a2' });
      const known = new Map([['a.md', { mtime: 1, hash: 'a1' }]]);
      const changes = store.getChangedDocs(known);
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual(['a.md']);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect deleted docs', () => {
      const known = new Map([
        ['a.md', { mtime: 1, hash: 'a' }],
        ['b.md', { mtime: 2, hash: 'b' }],
      ]);
      const changes = store.getChangedDocs(known);
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted.sort()).toEqual(['a.md', 'b.md']);
    });
  });

  describe('nodes CRUD', () => {
    it('should insert nodes in bulk', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
        { nodeId: 'n2', docId, level: 1, headingPath: 'Intro', startChar: 0, endChar: 50, shardId: 0 },
      ]);
      const nodes = store.getNodesByDoc(docId);
      expect(nodes.length).toBe(2);
    });
  });

  describe('leaves CRUD', () => {
    it('should insert leaves in bulk', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
      ]);
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 0, embedding: null },
        { leafId: 'l2', docId, nodeId: 'n1', startChar: 40, endChar: 100, textHash: 'h2', shardId: 0, embedding: null },
      ]);
      const leaves = store.getLeavesByDoc(docId);
      expect(leaves.length).toBe(2);
    });

    it('should get leaf by id', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
      ]);
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 0, embedding: null },
      ]);
      const leaf = store.getLeafById('l1');
      expect(leaf).not.toBeNull();
      expect(leaf!.leafId).toBe('l1');
      expect(leaf!.startChar).toBe(0);
      expect(leaf!.endChar).toBe(50);
    });

    it('should get leaves by shard', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 5 },
      ]);
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 5, embedding: null },
        { leafId: 'l2', docId, nodeId: 'n1', startChar: 50, endChar: 100, textHash: 'h2', shardId: 7, embedding: null },
      ]);
      const shard5Leaves = store.getLeavesByShard(5);
      expect(shard5Leaves.length).toBe(1);
      expect(shard5Leaves[0]!.leafId).toBe('l1');
    });
  });

  describe('embedding cache', () => {
    it('should store and retrieve embeddings', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
      ]);
      const embedding = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) embedding[i] = i / 1024;
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 0, embedding: Buffer.from(embedding.buffer) },
      ]);
      const leaf = store.getLeafWithEmbedding('l1');
      expect(leaf).not.toBeNull();
      expect(leaf!.embedding).not.toBeNull();
      const retrieved = new Float32Array(leaf!.embedding!.buffer, leaf!.embedding!.byteOffset, 1024);
      expect(retrieved[0]).toBeCloseTo(0, 5);
      expect(retrieved[512]).toBeCloseTo(0.5, 5);
    });

    it('should update embedding for existing leaf', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
      ]);
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 0, embedding: null },
      ]);
      const embedding = new Float32Array(1024).fill(0.5);
      store.updateEmbedding('l1', Buffer.from(embedding.buffer));
      const leaf = store.getLeafWithEmbedding('l1');
      expect(leaf!.embedding).not.toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('should delete doc and cascade to nodes and leaves', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 100, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 100, shardId: 0 },
      ]);
      store.insertLeaves([
        { leafId: 'l1', docId, nodeId: 'n1', startChar: 0, endChar: 50, textHash: 'h1', shardId: 0, embedding: null },
      ]);
      store.deleteDocCascade('test.md');
      expect(store.getDoc('test.md')).toBeNull();
      expect(store.getNodesByDoc(docId).length).toBe(0);
      expect(store.getLeavesByDoc(docId).length).toBe(0);
    });
  });

  describe('integrity check', () => {
    it('should return ok for valid database', () => {
      const result = store.checkIntegrity();
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('bulk performance', () => {
    it('should insert 10K leaves in under 1 second', () => {
      const docId = store.upsertDoc({ docUri: 'test.md', mtime: 1, size: 1000000, hash: 'x' });
      store.insertNodes([
        { nodeId: 'n1', docId, level: 0, headingPath: '', startChar: 0, endChar: 1000000, shardId: 0 },
      ]);
      const leaves = [];
      for (let i = 0; i < 10000; i++) {
        leaves.push({
          leafId: `l${i}`, docId, nodeId: 'n1', startChar: i * 100, endChar: (i + 1) * 100,
          textHash: `h${i}`, shardId: i % 128, embedding: null,
        });
      }
      const start = Date.now();
      store.insertLeaves(leaves);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(store.getCounts().leaves).toBe(10000);
    });
  });
});

