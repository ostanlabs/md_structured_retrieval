/**
 * Retrieval Pipeline Tests
 *
 * TDD: These tests define the expected behavior of the full retrieval pipeline
 * that orchestrates vector search, BM25 search, hybrid scoring, span merging,
 * and excerpt extraction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetrievalPipeline, QueryParams, SearchResult } from '../retrieval-pipeline.js';

describe('RetrievalPipeline', () => {
  // Mock dependencies
  const mockVectorSearch = vi.fn();
  const mockBm25Search = vi.fn();
  const mockGetLeafMetadata = vi.fn();
  const mockExtractExcerpt = vi.fn();

  let pipeline: RetrievalPipeline;

  beforeEach(() => {
    vi.clearAllMocks();

    pipeline = new RetrievalPipeline({
      vectorSearch: mockVectorSearch,
      bm25Search: mockBm25Search,
      getLeafMetadata: mockGetLeafMetadata,
      extractExcerpt: mockExtractExcerpt,
    });

    // Default mock implementations
    mockVectorSearch.mockResolvedValue([]);
    mockBm25Search.mockResolvedValue([]);
    mockGetLeafMetadata.mockResolvedValue(null);
    mockExtractExcerpt.mockReturnValue({ excerpt: 'test excerpt', truncated: false });
  });

  describe('query()', () => {
    it('should return empty results for empty query', async () => {
      const result = await pipeline.query({ query: '', limit: 10 });
      expect(result.results).toEqual([]);
    });

    it('should call vector search with query', async () => {
      await pipeline.query({ query: 'test query', limit: 10 });
      expect(mockVectorSearch).toHaveBeenCalledWith('test query', expect.any(Number));
    });

    it('should call BM25 search with query', async () => {
      await pipeline.query({ query: 'test query', limit: 10 });
      expect(mockBm25Search).toHaveBeenCalledWith('test query', expect.any(Number));
    });

    it('should combine vector and BM25 results', async () => {
      mockVectorSearch.mockResolvedValue([
        { leafId: 'l1', vectorScore: 0.9 },
      ]);
      mockBm25Search.mockResolvedValue([
        { leafId: 'l1', bm25Score: 0.8 },
      ]);
      mockGetLeafMetadata.mockResolvedValue({
        docUri: 'test.md',
        headingPath: 'Test',
        startChar: 0,
        endChar: 100,
      });

      const result = await pipeline.query({ query: 'test', limit: 10 });

      expect(result.results.length).toBe(1);
      expect(result.results[0]!.docUri).toBe('test.md');
    });

    it('should respect limit parameter', async () => {
      mockVectorSearch.mockResolvedValue([
        { leafId: 'l1', vectorScore: 0.9 },
        { leafId: 'l2', vectorScore: 0.8 },
        { leafId: 'l3', vectorScore: 0.7 },
      ]);
      mockGetLeafMetadata.mockImplementation((leafId: string) => ({
        docUri: `${leafId}.md`,
        headingPath: 'Test',
        startChar: 0,
        endChar: 100,
      }));

      const result = await pipeline.query({ query: 'test', limit: 2 });

      expect(result.results.length).toBe(2);
    });

    it('should include all required fields in SearchResult', async () => {
      mockVectorSearch.mockResolvedValue([{ leafId: 'l1', vectorScore: 0.9 }]);
      mockBm25Search.mockResolvedValue([{ leafId: 'l1', bm25Score: 0.8 }]);
      mockGetLeafMetadata.mockResolvedValue({
        docUri: 'test.md',
        headingPath: 'Section → Subsection',
        startChar: 100,
        endChar: 500,
      });
      mockExtractExcerpt.mockReturnValue({ excerpt: 'Test content...', truncated: true });

      const result = await pipeline.query({ query: 'test', limit: 10 });
      const sr = result.results[0]!;

      expect(sr.docUri).toBe('test.md');
      expect(sr.headingPath).toBe('Section → Subsection');
      expect(sr.startChar).toBe(100);
      expect(sr.endChar).toBe(500);
      expect(sr.excerpt).toBe('Test content...');
      expect(sr.excerptTruncated).toBe(true);
      expect(sr.score).toBeGreaterThan(0);
      expect(sr.vectorScore).toBe(0.9);
      expect(sr.bm25Score).toBe(0.8);
    });

    it('should include tookMs in result meta', async () => {
      const result = await pipeline.query({ query: 'test', limit: 10 });
      expect(result.meta.tookMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('filters', () => {
    it('should filter by docUri prefix', async () => {
      mockVectorSearch.mockResolvedValue([
        { leafId: 'l1', vectorScore: 0.9 },
        { leafId: 'l2', vectorScore: 0.8 },
      ]);
      mockGetLeafMetadata.mockImplementation((leafId: string) => ({
        docUri: leafId === 'l1' ? 'notes/daily/2024.md' : 'archive/old.md',
        headingPath: 'Test',
        startChar: 0,
        endChar: 100,
      }));

      const result = await pipeline.query({
        query: 'test',
        limit: 10,
        filter: { docUriPrefix: 'notes/' },
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0]!.docUri).toBe('notes/daily/2024.md');
    });

    it('should filter by headingPath prefix', async () => {
      mockVectorSearch.mockResolvedValue([
        { leafId: 'l1', vectorScore: 0.9 },
        { leafId: 'l2', vectorScore: 0.8 },
      ]);
      mockGetLeafMetadata.mockImplementation((leafId: string) => ({
        docUri: 'test.md',
        headingPath: leafId === 'l1' ? 'API → Methods' : 'Introduction',
        startChar: 0,
        endChar: 100,
      }));

      const result = await pipeline.query({
        query: 'test',
        limit: 10,
        filter: { headingPathPrefix: 'API' },
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0]!.headingPath).toBe('API → Methods');
    });
  });
});

