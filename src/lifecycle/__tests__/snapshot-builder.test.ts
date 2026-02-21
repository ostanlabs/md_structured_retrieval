/**
 * Snapshot Builder Tests
 *
 * TDD: These tests define the expected behavior of the snapshot builder
 * that creates and updates search indexes from vault files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SnapshotBuilder, BuildResult, BuildProgress } from '../snapshot-builder.js';
import { FileInfo } from '../file-scanner.js';

describe('SnapshotBuilder', () => {
  // Mock dependencies
  const mockParseFile = vi.fn();
  const mockChunkLeaves = vi.fn();
  const mockEmbed = vi.fn();
  const mockStoreMetadata = vi.fn();
  const mockIndexBm25 = vi.fn();
  const mockIndexVector = vi.fn();
  const mockGetCachedEmbedding = vi.fn();

  let builder: SnapshotBuilder;

  beforeEach(() => {
    vi.clearAllMocks();

    builder = new SnapshotBuilder({
      parseFile: mockParseFile,
      chunkLeaves: mockChunkLeaves,
      embed: mockEmbed,
      storeMetadata: mockStoreMetadata,
      indexBm25: mockIndexBm25,
      indexVector: mockIndexVector,
      getCachedEmbedding: mockGetCachedEmbedding,
    });

    // Default mock implementations
    mockParseFile.mockResolvedValue({ tree: { children: [] }, leaves: [] });
    mockChunkLeaves.mockReturnValue([]);
    mockEmbed.mockResolvedValue([]);
    mockStoreMetadata.mockResolvedValue(undefined);
    mockIndexBm25.mockResolvedValue(undefined);
    mockIndexVector.mockResolvedValue(undefined);
    mockGetCachedEmbedding.mockReturnValue(null);
  });

  describe('buildFull()', () => {
    it('should return success for empty file list', async () => {
      const result = await builder.buildFull([]);
      expect(result.success).toBe(true);
      expect(result.stats.filesProcessed).toBe(0);
    });

    it('should process all files', async () => {
      const files: FileInfo[] = [
        { docUri: 'a.md', size: 100, mtimeMs: 1000 },
        { docUri: 'b.md', size: 200, mtimeMs: 2000 },
      ];

      await builder.buildFull(files);

      expect(mockParseFile).toHaveBeenCalledTimes(2);
      expect(mockParseFile).toHaveBeenCalledWith('a.md');
      expect(mockParseFile).toHaveBeenCalledWith('b.md');
    });

    it('should report progress', async () => {
      const files: FileInfo[] = [
        { docUri: 'a.md', size: 100, mtimeMs: 1000 },
        { docUri: 'b.md', size: 200, mtimeMs: 2000 },
      ];

      const progressUpdates: BuildProgress[] = [];
      await builder.buildFull(files, (p) => progressUpdates.push({ ...p }));

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]!.phase).toBe('complete');
    });

    it('should include timing in result', async () => {
      const result = await builder.buildFull([]);
      expect(result.stats.tookMs).toBeGreaterThanOrEqual(0);
    });

    it('should count chunks and embeddings', async () => {
      const files: FileInfo[] = [{ docUri: 'a.md', size: 100, mtimeMs: 1000 }];

      mockParseFile.mockResolvedValue({
        tree: { children: [] },
        leaves: [{ id: 'l1', text: 'chunk1' }, { id: 'l2', text: 'chunk2' }],
      });
      mockChunkLeaves.mockReturnValue([
        { leafId: 'l1', text: 'chunk1' },
        { leafId: 'l2', text: 'chunk2' },
      ]);
      mockEmbed.mockResolvedValue([
        { leafId: 'l1', embedding: new Float32Array(1024) },
        { leafId: 'l2', embedding: new Float32Array(1024) },
      ]);

      const result = await builder.buildFull(files);

      expect(result.stats.chunksCreated).toBe(2);
      expect(result.stats.embeddingsCreated).toBe(2);
    });
  });

  describe('buildIncremental()', () => {
    it('should only process changed files', async () => {
      const added: FileInfo[] = [{ docUri: 'new.md', size: 100, mtimeMs: 1000 }];
      const modified: FileInfo[] = [{ docUri: 'changed.md', size: 200, mtimeMs: 2000 }];
      const deleted: string[] = ['old.md'];

      await builder.buildIncremental(added, modified, deleted);

      expect(mockParseFile).toHaveBeenCalledTimes(2);
      expect(mockParseFile).toHaveBeenCalledWith('new.md');
      expect(mockParseFile).toHaveBeenCalledWith('changed.md');
    });

    it('should use cached embeddings for unchanged chunks', async () => {
      const modified: FileInfo[] = [{ docUri: 'a.md', size: 100, mtimeMs: 1000 }];

      mockParseFile.mockResolvedValue({
        tree: { children: [] },
        leaves: [{ id: 'l1', text: 'unchanged chunk' }],
      });
      mockChunkLeaves.mockReturnValue([{ leafId: 'l1', text: 'unchanged chunk' }]);
      mockGetCachedEmbedding.mockReturnValue(new Float32Array(1024));

      const result = await builder.buildIncremental([], modified, []);

      // Should not call embed for cached chunks
      expect(mockEmbed).not.toHaveBeenCalled();
      expect(result.stats.embeddingsCached).toBe(1);
    });

    it('should embed new chunks', async () => {
      const added: FileInfo[] = [{ docUri: 'new.md', size: 100, mtimeMs: 1000 }];

      mockParseFile.mockResolvedValue({
        tree: { children: [] },
        leaves: [{ id: 'l1', text: 'new chunk' }],
      });
      mockChunkLeaves.mockReturnValue([{ leafId: 'l1', text: 'new chunk' }]);
      mockGetCachedEmbedding.mockReturnValue(null); // Not cached
      mockEmbed.mockResolvedValue([{ leafId: 'l1', embedding: new Float32Array(1024) }]);

      const result = await builder.buildIncremental(added, [], []);

      expect(mockEmbed).toHaveBeenCalled();
      expect(result.stats.embeddingsCreated).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should continue on file parse error', async () => {
      const files: FileInfo[] = [
        { docUri: 'bad.md', size: 100, mtimeMs: 1000 },
        { docUri: 'good.md', size: 200, mtimeMs: 2000 },
      ];

      mockParseFile.mockImplementation((docUri: string) => {
        if (docUri === 'bad.md') throw new Error('Parse error');
        return { tree: { children: [] }, leaves: [] };
      });

      const result = await builder.buildFull(files);

      expect(result.success).toBe(true);
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.filesFailed).toBe(1);
    });
  });
});

