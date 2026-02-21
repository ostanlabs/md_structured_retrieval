/**
 * Retrieval Pipeline - Orchestrates the full search flow
 *
 * Combines vector search, BM25 search, hybrid scoring, span merging,
 * and excerpt extraction into a single query interface.
 */

import { HybridScorer, VectorResult, BM25Result } from './hybrid-scorer.js';
import { SpanMerger, Span } from './span-merger.js';

export interface QueryParams {
  query: string;
  limit: number;
  filter?: {
    docUriPrefix?: string;
    headingPathPrefix?: string;
  };
}

export interface SearchResult {
  docUri: string;
  headingPath: string;
  startChar: number;
  endChar: number;
  excerpt: string;
  excerptTruncated: boolean;
  score: number;
  vectorScore: number;
  bm25Score: number;
}

export interface QueryResult {
  results: SearchResult[];
  meta: {
    tookMs: number;
  };
}

export interface LeafMetadata {
  docUri: string;
  headingPath: string;
  startChar: number;
  endChar: number;
}

export interface ExcerptResult {
  excerpt: string;
  truncated: boolean;
}

export interface PipelineDependencies {
  vectorSearch: (query: string, limit: number) => Promise<VectorResult[]>;
  bm25Search: (query: string, limit: number) => Promise<BM25Result[]>;
  getLeafMetadata: (leafId: string) => Promise<LeafMetadata | null>;
  extractExcerpt: (docUri: string, startChar: number, endChar: number) => ExcerptResult;
}

export class RetrievalPipeline {
  private deps: PipelineDependencies;
  private hybridScorer: HybridScorer;
  private spanMerger: SpanMerger;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
    this.hybridScorer = new HybridScorer();
    this.spanMerger = new SpanMerger();
  }

  async query(params: QueryParams): Promise<QueryResult> {
    const startTime = Date.now();

    // Handle empty query
    if (!params.query.trim()) {
      return { results: [], meta: { tookMs: Date.now() - startTime } };
    }

    // Fetch more results than needed to account for filtering and merging
    const fetchLimit = params.limit * 3;

    // Run vector and BM25 searches in parallel
    const [vectorResults, bm25Results] = await Promise.all([
      this.deps.vectorSearch(params.query, fetchLimit),
      this.deps.bm25Search(params.query, fetchLimit),
    ]);

    // Fuse results using hybrid scoring
    const hybridResults = this.hybridScorer.fuse(vectorResults, bm25Results);

    // Get metadata for all results
    const resultsWithMetadata: Array<{
      leafId: string;
      score: number;
      vectorScore: number;
      bm25Score: number;
      metadata: LeafMetadata;
    }> = [];

    for (const hr of hybridResults) {
      const metadata = await this.deps.getLeafMetadata(hr.leafId);
      if (!metadata) continue;

      // Apply filters
      if (params.filter?.docUriPrefix && !metadata.docUri.startsWith(params.filter.docUriPrefix)) {
        continue;
      }
      if (
        params.filter?.headingPathPrefix &&
        !metadata.headingPath.startsWith(params.filter.headingPathPrefix)
      ) {
        continue;
      }

      resultsWithMetadata.push({
        leafId: hr.leafId,
        score: hr.score,
        vectorScore: hr.vectorScore,
        bm25Score: hr.bm25Score,
        metadata,
      });
    }

    // Build spans for merging
    const spans: Span[] = resultsWithMetadata.map((r) => ({
      docUri: r.metadata.docUri,
      startChar: r.metadata.startChar,
      endChar: r.metadata.endChar,
      score: r.score,
      leafIds: [r.leafId],
    }));

    // Merge overlapping spans
    const mergedSpans = this.spanMerger.merge(spans);

    // Build final results with excerpts
    const results: SearchResult[] = [];
    for (const span of mergedSpans.slice(0, params.limit)) {
      // Find the best-scoring leaf in this span for scores
      const leafData = resultsWithMetadata.find((r) => span.leafIds.includes(r.leafId));
      if (!leafData) continue;

      const excerptResult = this.deps.extractExcerpt(span.docUri, span.startChar, span.endChar);

      results.push({
        docUri: span.docUri,
        headingPath: leafData.metadata.headingPath,
        startChar: span.startChar,
        endChar: span.endChar,
        excerpt: excerptResult.excerpt,
        excerptTruncated: excerptResult.truncated,
        score: span.score,
        vectorScore: leafData.vectorScore,
        bm25Score: leafData.bm25Score,
      });
    }

    return {
      results,
      meta: { tookMs: Date.now() - startTime },
    };
  }
}

