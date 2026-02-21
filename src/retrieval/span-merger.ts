/**
 * Span Merger - Combines adjacent/overlapping search result spans
 *
 * When multiple chunks from the same document match a query, their spans
 * may overlap or be adjacent. This module merges them into contiguous spans
 * for cleaner excerpt extraction.
 */

export interface Span {
  docUri: string;
  startChar: number;
  endChar: number;
  score: number;
  leafIds: string[];
}

export interface MergedSpan extends Span {
  // Same structure, but represents a merged result
}

export class SpanMerger {
  /**
   * Merge overlapping and adjacent spans within the same document.
   * Returns merged spans sorted by score descending.
   */
  merge(spans: Span[]): MergedSpan[] {
    return this.mergeWithGap(spans, 0);
  }

  /**
   * Merge spans that are within `gapThreshold` characters of each other.
   * A gap of 0 means only overlapping/adjacent spans are merged.
   */
  mergeWithGap(spans: Span[], gapThreshold: number): MergedSpan[] {
    if (spans.length === 0) return [];

    // Group spans by document
    const byDoc = new Map<string, Span[]>();
    for (const span of spans) {
      const existing = byDoc.get(span.docUri) || [];
      existing.push(span);
      byDoc.set(span.docUri, existing);
    }

    const results: MergedSpan[] = [];

    // Process each document's spans
    for (const [docUri, docSpans] of byDoc) {
      // Sort by startChar
      const sorted = [...docSpans].sort((a, b) => a.startChar - b.startChar);

      // Merge overlapping/adjacent spans
      const merged: MergedSpan[] = [];
      let current: MergedSpan | null = null;

      for (const span of sorted) {
        if (current === null) {
          current = {
            docUri,
            startChar: span.startChar,
            endChar: span.endChar,
            score: span.score,
            leafIds: [...span.leafIds],
          };
        } else if (span.startChar <= current.endChar + gapThreshold) {
          // Overlapping or within gap threshold - merge
          current.endChar = Math.max(current.endChar, span.endChar);
          current.score = Math.max(current.score, span.score);
          // Add unique leafIds
          for (const id of span.leafIds) {
            if (!current.leafIds.includes(id)) {
              current.leafIds.push(id);
            }
          }
        } else {
          // Non-overlapping - save current and start new
          merged.push(current);
          current = {
            docUri,
            startChar: span.startChar,
            endChar: span.endChar,
            score: span.score,
            leafIds: [...span.leafIds],
          };
        }
      }

      // Don't forget the last span
      if (current !== null) {
        merged.push(current);
      }

      results.push(...merged);
    }

    // Sort all results by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }
}

