/**
 * Excerpt Extractor - Reads text from files and handles truncation
 *
 * Extracts text excerpts from markdown files using character offsets.
 * Handles truncation at word boundaries for clean display.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ExcerptResult {
  excerpt: string;
  truncated: boolean;
}

export interface ExcerptRequest {
  docUri: string;
  startChar: number;
  endChar: number;
}

export interface ExcerptOptions {
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 1000;

export class ExcerptExtractor {
  private vaultPath: string;
  private fileCache: Map<string, string> = new Map();

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Extract excerpt from a file at given character offsets.
   */
  extract(docUri: string, startChar: number, endChar: number, options?: ExcerptOptions): ExcerptResult {
    const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;

    // Read file content (use cache if available)
    const content = this.readFile(docUri);

    // Extract the span
    let excerpt = content.slice(startChar, endChar);
    let truncated = false;

    // Truncate if needed
    if (excerpt.length > maxLength) {
      excerpt = this.truncateAtWordBoundary(excerpt, maxLength);
      truncated = true;
    }

    return { excerpt, truncated };
  }

  /**
   * Extract multiple excerpts efficiently (caches file reads).
   */
  extractBatch(requests: ExcerptRequest[], options?: ExcerptOptions): ExcerptResult[] {
    return requests.map((req) => this.extract(req.docUri, req.startChar, req.endChar, options));
  }

  /**
   * Clear the file cache (useful after file changes).
   */
  clearCache(): void {
    this.fileCache.clear();
  }

  private readFile(docUri: string): string {
    // Check cache first
    const cached = this.fileCache.get(docUri);
    if (cached !== undefined) {
      return cached;
    }

    // Read from disk
    const fullPath = path.join(this.vaultPath, docUri);
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Cache for future reads
    this.fileCache.set(docUri, content);

    return content;
  }

  private truncateAtWordBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Find last space before maxLength
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.5) {
      // Found a reasonable word boundary
      return truncated.slice(0, lastSpace);
    }

    // No good word boundary, just truncate
    return truncated;
  }
}

