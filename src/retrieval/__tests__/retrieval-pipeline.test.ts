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
    describe('docUriPrefix', () => {
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

      it('should match exact prefix (not substring)', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => ({
          docUri: leafId === 'l1' ? 'my-notes/doc.md' : 'notes/doc.md',
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
        expect(result.results[0]!.docUri).toBe('notes/doc.md');
      });
    });

    describe('docUris', () => {
      it('should filter by exact docUri match', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => ({
          docUri: leafId === 'l1' ? 'doc1.md' : leafId === 'l2' ? 'doc2.md' : 'doc3.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        }));

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUris: ['doc1.md', 'doc3.md'] },
        });

        expect(result.results.length).toBe(2);
        const docUris = result.results.map(r => r.docUri);
        expect(docUris).toContain('doc1.md');
        expect(docUris).toContain('doc3.md');
        expect(docUris).not.toContain('doc2.md');
      });

      it('should return no results when docUris list does not match any document', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'existing.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUris: ['nonexistent.md'] },
        });

        expect(result.results.length).toBe(0);
      });

      it('should not filter when docUris is empty array', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUris: [] },
        });

        expect(result.results.length).toBe(1);
      });

      it('should require exact match (not partial)', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'notes/my-document.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUris: ['my-document.md'] }, // Missing 'notes/' prefix
        });

        expect(result.results.length).toBe(0);
      });
    });

    describe('headingPathPrefix', () => {
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

      it('should be case-sensitive for prefix matching', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'API → Methods',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathPrefix: 'api' }, // lowercase
        });

        expect(result.results.length).toBe(0);
      });
    });

    describe('headingPathContains', () => {
      it('should filter by substring match in headingPath', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => ({
          docUri: 'test.md',
          headingPath:
            leafId === 'l1'
              ? 'Project → Milestone 1 → Tasks'
              : leafId === 'l2'
                ? 'Project → Story A → Details'
                : 'Project → Overview',
          startChar: 0,
          endChar: 100,
        }));

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Milestone' },
        });

        expect(result.results.length).toBe(1);
        expect(result.results[0]!.headingPath).toBe('Project → Milestone 1 → Tasks');
      });

      it('should NOT use prefix matching (bug fix verification)', async () => {
        // This test verifies the bug fix: headingPathContains should use
        // substring matching (includes), NOT prefix matching (startsWith).
        // The old buggy code would fail this test because "Milestone" doesn't
        // START the heading path "Project → Milestone".
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Project → Milestone → Tasks', // "Milestone" is in the middle
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Milestone' },
        });

        // With the fix: should find it (substring match)
        // With the bug: would NOT find it (prefix match would fail)
        expect(result.results.length).toBe(1);
      });

      it('should be case-insensitive', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Project → MILESTONE → Tasks',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'milestone' }, // lowercase
        });

        expect(result.results.length).toBe(1);
      });

      it('should match substring anywhere in path', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
        ]);
        // Use different documents to avoid span merging
        mockGetLeafMetadata.mockImplementation((leafId: string) => ({
          docUri: `${leafId}.md`, // Different doc for each leaf
          headingPath:
            leafId === 'l1'
              ? 'Story → Details' // starts with
              : leafId === 'l2'
                ? 'Project → Story → Tasks' // middle
                : 'Overview → User Story', // ends with
          startChar: 0,
          endChar: 100,
        }));

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Story' },
        });

        expect(result.results.length).toBe(3);
      });

      it('should match partial words (substring matching)', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Milestones → Overview', // "Milestones" contains "Milestone"
          startChar: 0,
          endChar: 100,
        });

        // "Milestone" is a substring of "Milestones", so it matches
        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Milestone' },
        });

        expect(result.results.length).toBe(1);
      });

      it('should correctly distinguish between milestones and stories (original bug scenario)', async () => {
        // This test verifies the fix for the original bug where users expected
        // to get milestones but got stories back and vice versa
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.85 },
          { leafId: 'l3', vectorScore: 0.8 },
          { leafId: 'l4', vectorScore: 0.75 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => {
          const data: Record<string, { docUri: string; headingPath: string }> = {
            l1: { docUri: 'project.md', headingPath: 'Q1 Planning → Milestone: Launch MVP' },
            l2: { docUri: 'project.md', headingPath: 'Q1 Planning → Story: User Login' },
            l3: { docUri: 'project.md', headingPath: 'Q1 Planning → Milestone: Beta Release' },
            l4: { docUri: 'project.md', headingPath: 'Q1 Planning → Story: Dashboard' },
          };
          return {
            ...data[leafId],
            startChar: Number(leafId.slice(1)) * 100, // Different char ranges to avoid merging
            endChar: Number(leafId.slice(1)) * 100 + 99,
          };
        });

        // User wants only milestones
        const milestoneResult = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Milestone' },
        });

        expect(milestoneResult.results.length).toBe(2);
        expect(milestoneResult.results.every(r => r.headingPath.includes('Milestone'))).toBe(true);
        expect(milestoneResult.results.some(r => r.headingPath.includes('Story'))).toBe(false);

        // User wants only stories
        const storyResult = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'Story' },
        });

        expect(storyResult.results.length).toBe(2);
        expect(storyResult.results.every(r => r.headingPath.includes('Story'))).toBe(true);
        expect(storyResult.results.some(r => r.headingPath.includes('Milestone'))).toBe(false);
      });
    });

    describe('combined filters (AND logic)', () => {
      it('should apply all filters with AND logic', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
          { leafId: 'l4', vectorScore: 0.6 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => {
          const data: Record<string, { docUri: string; headingPath: string }> = {
            l1: { docUri: 'notes/project.md', headingPath: 'API → Milestone 1' },
            l2: { docUri: 'notes/other.md', headingPath: 'API → Story' },
            l3: { docUri: 'archive/project.md', headingPath: 'API → Milestone 2' },
            l4: { docUri: 'notes/project.md', headingPath: 'Overview' },
          };
          return {
            ...data[leafId],
            startChar: 0,
            endChar: 100,
          };
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: {
            docUriPrefix: 'notes/',
            headingPathContains: 'Milestone',
          },
        });

        // Only l1 matches both: notes/ prefix AND contains "Milestone"
        expect(result.results.length).toBe(1);
        expect(result.results[0]!.docUri).toBe('notes/project.md');
        expect(result.results[0]!.headingPath).toBe('API → Milestone 1');
      });

      it('should combine docUris with headingPathContains', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => {
          const data: Record<string, { docUri: string; headingPath: string }> = {
            l1: { docUri: 'doc1.md', headingPath: 'Milestone → Tasks' },
            l2: { docUri: 'doc1.md', headingPath: 'Story → Tasks' },
            l3: { docUri: 'doc2.md', headingPath: 'Milestone → Overview' },
          };
          return {
            ...data[leafId],
            startChar: 0,
            endChar: 100,
          };
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: {
            docUris: ['doc1.md'],
            headingPathContains: 'Milestone',
          },
        });

        // Only l1 matches: doc1.md AND contains "Milestone"
        expect(result.results.length).toBe(1);
        expect(result.results[0]!.docUri).toBe('doc1.md');
        expect(result.results[0]!.headingPath).toBe('Milestone → Tasks');
      });

      it('should combine headingPathPrefix with headingPathContains', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
          { leafId: 'l3', vectorScore: 0.7 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => {
          const data: Record<string, { docUri: string; headingPath: string }> = {
            l1: { docUri: 'test.md', headingPath: 'API → Milestone → Details' },
            l2: { docUri: 'test.md', headingPath: 'API → Story → Details' },
            l3: { docUri: 'test.md', headingPath: 'Overview → Milestone' },
          };
          return {
            ...data[leafId],
            startChar: 0,
            endChar: 100,
          };
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: {
            headingPathPrefix: 'API',
            headingPathContains: 'Milestone',
          },
        });

        // Only l1 matches: starts with "API" AND contains "Milestone"
        expect(result.results.length).toBe(1);
        expect(result.results[0]!.headingPath).toBe('API → Milestone → Details');
      });
    });

    describe('edge cases', () => {
      it('should handle undefined filter gracefully', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: undefined,
        });

        expect(result.results.length).toBe(1);
      });

      it('should handle empty filter object gracefully', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'test.md',
          headingPath: 'Test',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: {},
        });

        expect(result.results.length).toBe(1);
      });

      it('should handle special characters in filter values', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'notes/2024-01-01.md',
          headingPath: 'Project → Phase (1) → [Draft]',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: '(1)' },
        });

        expect(result.results.length).toBe(1);
      });

      it('should handle Unicode characters in filter values', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'notes/日本語.md',
          headingPath: 'プロジェクト → マイルストーン',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: 'マイルストーン' },
        });

        expect(result.results.length).toBe(1);
      });

      it('should handle arrow separator in contains filter', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
        ]);
        mockGetLeafMetadata.mockImplementation((leafId: string) => ({
          docUri: 'test.md',
          headingPath: leafId === 'l1' ? 'A → B → C' : 'A > B > C',
          startChar: 0,
          endChar: 100,
        }));

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { headingPathContains: ' → ' },
        });

        expect(result.results.length).toBe(1);
        expect(result.results[0]!.headingPath).toBe('A → B → C');
      });

      it('should return empty results when all results are filtered out', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
          { leafId: 'l2', vectorScore: 0.8 },
        ]);
        mockGetLeafMetadata.mockImplementation(() => ({
          docUri: 'archive/old.md',
          headingPath: 'Legacy',
          startChar: 0,
          endChar: 100,
        }));

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUriPrefix: 'notes/' },
        });

        expect(result.results.length).toBe(0);
      });

      it('should still include tookMs when all results are filtered', async () => {
        mockVectorSearch.mockResolvedValue([
          { leafId: 'l1', vectorScore: 0.9 },
        ]);
        mockGetLeafMetadata.mockResolvedValue({
          docUri: 'archive/old.md',
          headingPath: 'Legacy',
          startChar: 0,
          endChar: 100,
        });

        const result = await pipeline.query({
          query: 'test',
          limit: 10,
          filter: { docUriPrefix: 'notes/' },
        });

        expect(result.meta.tookMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('performance considerations', () => {
      it('should fetch extra results to account for filtering', async () => {
        // With limit=5, should fetch limit*3=15 to account for filtering
        mockVectorSearch.mockResolvedValue([]);
        mockBm25Search.mockResolvedValue([]);

        await pipeline.query({
          query: 'test',
          limit: 5,
          filter: { docUriPrefix: 'notes/' },
        });

        expect(mockVectorSearch).toHaveBeenCalledWith('test', 15);
        expect(mockBm25Search).toHaveBeenCalledWith('test', 15);
      });
    });
  });
});

