/**
 * ShardRouter Tests
 *
 * TDD: These tests define the expected behavior of the ShardRouter class.
 */

import { describe, it, expect } from 'vitest';
import { ShardRouter, fnv1a32 } from '../shard-router.js';

describe('fnv1a32', () => {
  it('should return consistent hash for same input', () => {
    const hash1 = fnv1a32('test.md');
    const hash2 = fnv1a32('test.md');
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = fnv1a32('file1.md');
    const hash2 = fnv1a32('file2.md');
    expect(hash1).not.toBe(hash2);
  });

  it('should return unsigned 32-bit integer', () => {
    const hash = fnv1a32('test.md');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('should handle empty string', () => {
    const hash = fnv1a32('');
    expect(hash).toBe(0x811c9dc5); // FNV offset basis
  });

  it('should handle unicode characters', () => {
    const hash = fnv1a32('日本語.md');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('should handle long paths', () => {
    const longPath = 'a/'.repeat(100) + 'file.md';
    const hash = fnv1a32(longPath);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('ShardRouter', () => {
  describe('getShardId', () => {
    it('should return consistent shard for same docUri', () => {
      const router = new ShardRouter(128);
      const shard1 = router.getShardId('notes/test.md');
      const shard2 = router.getShardId('notes/test.md');
      expect(shard1).toBe(shard2);
    });

    it('should return shard within range [0, shardCount)', () => {
      const router = new ShardRouter(128);
      const testPaths = [
        'test.md',
        'folder/file.md',
        'deep/nested/path/file.md',
        'special-chars_123.md',
        '日本語/ファイル.md',
      ];

      for (const path of testPaths) {
        const shard = router.getShardId(path);
        expect(shard).toBeGreaterThanOrEqual(0);
        expect(shard).toBeLessThan(128);
      }
    });

    it('should work with different shard counts', () => {
      const router16 = new ShardRouter(16);
      const router256 = new ShardRouter(256);

      const shard16 = router16.getShardId('test.md');
      const shard256 = router256.getShardId('test.md');

      expect(shard16).toBeGreaterThanOrEqual(0);
      expect(shard16).toBeLessThan(16);
      expect(shard256).toBeGreaterThanOrEqual(0);
      expect(shard256).toBeLessThan(256);
    });

    it('should use default shard count of 128', () => {
      const router = new ShardRouter();
      const shard = router.getShardId('test.md');
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(128);
    });
  });

  describe('distribution uniformity', () => {
    it('should distribute files reasonably across shards', () => {
      const router = new ShardRouter(128);
      const shardCounts = new Map<number, number>();

      // Generate 1000 random-ish file paths
      for (let i = 0; i < 1000; i++) {
        const path = `folder${i % 10}/subfolder${i % 5}/file${i}.md`;
        const shard = router.getShardId(path);
        shardCounts.set(shard, (shardCounts.get(shard) || 0) + 1);
      }

      // Check that we're using a reasonable number of shards
      // With 1000 files and 128 shards, we expect ~7.8 files per shard on average
      // We should use at least 50 different shards (very conservative)
      expect(shardCounts.size).toBeGreaterThan(50);

      // No single shard should have more than 5% of all files (50 files)
      // This is a very loose bound to avoid flaky tests
      for (const count of shardCounts.values()) {
        expect(count).toBeLessThan(50);
      }
    });
  });
});

