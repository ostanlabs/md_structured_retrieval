/**
 * Node Embedding Calculation
 *
 * Computes node embeddings using MMR (Maximal Marginal Relevance) representative selection.
 * Instead of averaging ALL descendant leaf embeddings (which dilutes the signal for large sections),
 * we select representative leaves that balance relevance and diversity.
 */

import { l2Normalize, cosineSimilarity } from '../embedding/embedding-provider.js';

/**
 * Compute adaptive k based on number of leaves.
 * - 1-9 leaves → k=2
 * - 10-14 leaves → k=3
 * - 15-19 leaves → k=4
 * - 20+ leaves → k=5
 */
export function computeAdaptiveK(numLeaves: number): number {
  if (numLeaves <= 0) return 0;
  if (numLeaves === 1) return 1;

  const k = Math.min(5, Math.max(2, Math.ceil(numLeaves / 5)));
  return Math.min(k, numLeaves); // Can't select more than available
}

/**
 * Compute the centroid (mean) of a set of vectors.
 * Returns a normalized centroid.
 */
export function computeCentroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) {
    throw new Error('Cannot compute centroid of empty vector set');
  }

  const dim = vectors[0]!.length;
  const sum = new Float32Array(dim);

  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i]! += v[i]!;
    }
  }

  // Compute mean
  for (let i = 0; i < dim; i++) {
    sum[i]! /= vectors.length;
  }

  return l2Normalize(sum);
}

/**
 * Select k representative vectors using MMR (Maximal Marginal Relevance).
 *
 * MMR balances:
 * - Relevance: similarity to the centroid
 * - Diversity: dissimilarity to already selected vectors
 *
 * @param vectors - All candidate vectors (normalized)
 * @param k - Number of representatives to select
 * @param lambda - Balance factor (0.7 = favor relevance slightly over diversity)
 * @returns Indices of selected vectors
 */
export function selectRepresentativesMMR(
  vectors: Float32Array[],
  k: number,
  lambda: number = 0.7
): number[] {
  if (vectors.length === 0) return [];
  if (k >= vectors.length) {
    return vectors.map((_, i) => i);
  }

  // Compute centroid for relevance scoring
  const centroid = computeCentroid(vectors);

  // Pre-compute relevance scores (similarity to centroid)
  const relevanceScores = vectors.map((v) => cosineSimilarity(v, centroid));

  const selected: number[] = [];
  const remaining = new Set(vectors.map((_, i) => i));

  // Select first vector: highest relevance
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (const idx of remaining) {
    if (relevanceScores[idx]! > bestScore) {
      bestScore = relevanceScores[idx]!;
      bestIdx = idx;
    }
  }
  selected.push(bestIdx);
  remaining.delete(bestIdx);

  // Select remaining vectors using MMR
  while (selected.length < k && remaining.size > 0) {
    let bestMMRIdx = -1;
    let bestMMRScore = -Infinity;

    for (const idx of remaining) {
      // Relevance term: similarity to centroid
      const relevance = relevanceScores[idx]!;

      // Diversity term: max similarity to any already selected vector
      let maxSimToSelected = -Infinity;
      for (const selIdx of selected) {
        const sim = cosineSimilarity(vectors[idx]!, vectors[selIdx]!);
        if (sim > maxSimToSelected) {
          maxSimToSelected = sim;
        }
      }

      // MMR score: balance relevance and diversity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;

      if (mmrScore > bestMMRScore) {
        bestMMRScore = mmrScore;
        bestMMRIdx = idx;
      }
    }

    if (bestMMRIdx >= 0) {
      selected.push(bestMMRIdx);
      remaining.delete(bestMMRIdx);
    } else {
      break;
    }
  }

  return selected;
}

/**
 * Compute node embedding from descendant leaf embeddings.
 *
 * Uses MMR to select representative leaves, then computes the mean
 * of the selected representatives.
 *
 * @param leafVectors - Embeddings of all descendant leaves (normalized)
 * @param lambda - MMR balance factor (default: 0.7)
 * @returns Normalized node embedding
 */
export function computeNodeEmbedding(
  leafVectors: Float32Array[],
  lambda: number = 0.7
): Float32Array {
  if (leafVectors.length === 0) {
    throw new Error('Cannot compute node embedding from empty leaf set');
  }

  if (leafVectors.length === 1) {
    return leafVectors[0]!;
  }

  // Compute adaptive k
  const k = computeAdaptiveK(leafVectors.length);

  // Select representatives using MMR
  const selectedIndices = selectRepresentativesMMR(leafVectors, k, lambda);

  // Compute mean of selected representatives
  const selectedVectors = selectedIndices.map((i) => leafVectors[i]!);
  return computeCentroid(selectedVectors);
}

