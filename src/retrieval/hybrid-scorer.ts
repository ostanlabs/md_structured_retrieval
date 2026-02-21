/**
 * Hybrid Scorer - Combines vector similarity and BM25 lexical scores
 *
 * Uses weighted fusion to combine semantic (vector) and lexical (BM25) scores.
 * Default weights: 0.7 vector + 0.3 BM25 (semantic-first approach).
 */

export interface VectorResult {
  leafId: string;
  vectorScore: number; // 0-1 normalized
}

export interface BM25Result {
  leafId: string;
  bm25Score: number; // 0-1 normalized
  cachedVectorScore?: number; // Optional: computed from cached embedding
}

export interface HybridResult {
  leafId: string;
  score: number; // Combined hybrid score
  vectorScore: number;
  bm25Score: number;
}

export interface HybridWeights {
  vector: number;
  bm25: number;
}

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  vector: 0.7,
  bm25: 0.3,
};

export class HybridScorer {
  private weights: HybridWeights;

  constructor(weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS) {
    // Validate weights sum to 1.0
    const sum = weights.vector + weights.bm25;
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(`Hybrid weights must sum to 1.0, got ${sum}`);
    }
    this.weights = weights;
  }

  /**
   * Fuse vector and BM25 results into hybrid results.
   *
   * - Results appearing in both lists get combined scores
   * - Vector-only results get bm25Score = 0
   * - BM25-only results use cachedVectorScore if available, else 0
   *
   * Returns results sorted by hybrid score descending, with leafId tie-breaking.
   */
  fuse(vectorResults: VectorResult[], bm25Results: BM25Result[]): HybridResult[] {
    // Build maps for O(1) lookup
    const vectorMap = new Map<string, number>();
    for (const r of vectorResults) {
      vectorMap.set(r.leafId, r.vectorScore);
    }

    const bm25Map = new Map<string, { bm25Score: number; cachedVectorScore?: number }>();
    for (const r of bm25Results) {
      bm25Map.set(r.leafId, { bm25Score: r.bm25Score, cachedVectorScore: r.cachedVectorScore });
    }

    // Collect all unique leafIds
    const allLeafIds = new Set<string>([...vectorMap.keys(), ...bm25Map.keys()]);

    // Compute hybrid scores
    const results: HybridResult[] = [];
    for (const leafId of allLeafIds) {
      const vectorScore = vectorMap.get(leafId) ?? bm25Map.get(leafId)?.cachedVectorScore ?? 0;
      const bm25Score = bm25Map.get(leafId)?.bm25Score ?? 0;

      const score = this.weights.vector * vectorScore + this.weights.bm25 * bm25Score;

      results.push({
        leafId,
        score,
        vectorScore,
        bm25Score,
      });
    }

    // Sort by score descending, then by leafId for stable tie-breaking
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.leafId.localeCompare(b.leafId);
    });

    return results;
  }
}

