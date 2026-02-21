/**
 * Chunker
 *
 * Splits heading node content into chunks for embedding.
 * Respects paragraph boundaries and fenced code block integrity.
 */

import * as crypto from 'node:crypto';
import { FenceDetector } from './fence-detector.js';
import type { HeadingNode, Chunk, FencedRegion } from '../types.js';

export interface ChunkerConfig {
  targetMinTokens: number;
  targetMaxTokens: number;
  hardMaxTokens: number;
  minPreferredTokens: number;
  overlapTokens: number;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  targetMinTokens: 600,
  targetMaxTokens: 1000,
  hardMaxTokens: 1200,
  minPreferredTokens: 200,
  overlapTokens: 100,
};

export class Chunker {
  constructor(
    private config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG,
    private fenceDetector: FenceDetector,
    private tokenCounter: (text: string) => number,
  ) {}

  chunkNode(docUri: string, node: HeadingNode, normalizedText: string, shardId: number): Chunk[] {
    const contentStart = this.findContentStart(node, normalizedText);
    const contentEnd = node.children.length > 0 ? node.children[0]!.startChar : node.endChar;

    if (contentStart >= contentEnd) return [];

    const nodeText = normalizedText.slice(contentStart, contentEnd);
    if (nodeText.trim().length === 0) return [];

    const fencedRegions = this.fenceDetector.detect(nodeText);
    const paragraphs = this.splitIntoParagraphs(nodeText, fencedRegions);
    return this.accumulateChunks(paragraphs, docUri, node, contentStart, shardId);
  }

  private findContentStart(node: HeadingNode, text: string): number {
    const headingLineEnd = text.indexOf('\n', node.startChar);
    return headingLineEnd === -1 ? node.endChar : headingLineEnd + 1;
  }

  private splitIntoParagraphs(
    text: string,
    fencedRegions: FencedRegion[],
  ): Array<{ text: string; startOffset: number }> {
    const paragraphs: Array<{ text: string; startOffset: number }> = [];
    let pos = 0;

    while (pos < text.length) {
      const fence = fencedRegions.find((r) => r.startChar === pos);
      if (fence) {
        paragraphs.push({ text: text.slice(fence.startChar, fence.endChar), startOffset: fence.startChar });
        pos = fence.endChar;
        while (pos < text.length && text[pos] === '\n') pos++;
        continue;
      }

      let nextBreak = text.indexOf('\n\n', pos);
      const nextFence = fencedRegions.find((r) => r.startChar > pos);
      if (nextFence && (nextBreak === -1 || nextFence.startChar < nextBreak)) {
        nextBreak = nextFence.startChar;
      }

      if (nextBreak === -1) {
        const paraText = text.slice(pos);
        if (paraText.trim().length > 0) paragraphs.push({ text: paraText, startOffset: pos });
        break;
      }

      const paraText = text.slice(pos, nextBreak);
      if (paraText.trim().length > 0) paragraphs.push({ text: paraText, startOffset: pos });
      pos = nextBreak;
      while (pos < text.length && text[pos] === '\n') pos++;
    }

    return paragraphs;
  }

  private accumulateChunks(
    paragraphs: Array<{ text: string; startOffset: number }>,
    docUri: string,
    node: HeadingNode,
    contentStart: number,
    shardId: number,
  ): Chunk[] {
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let currentParagraphs: Array<{ text: string; startOffset: number }> = [];
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = this.tokenCounter(para.text);

      if (currentTokens + paraTokens > this.config.targetMaxTokens && currentParagraphs.length > 0) {
        chunks.push(this.createChunk(currentParagraphs, docUri, node, contentStart, shardId));
        currentParagraphs = [];
        currentTokens = 0;
      }

      currentParagraphs.push(para);
      currentTokens += paraTokens;
    }

    if (currentParagraphs.length > 0) {
      chunks.push(this.createChunk(currentParagraphs, docUri, node, contentStart, shardId));
    }

    return chunks;
  }

  private createChunk(
    paragraphs: Array<{ text: string; startOffset: number }>,
    docUri: string,
    node: HeadingNode,
    contentStart: number,
    shardId: number,
  ): Chunk {
    const firstPara = paragraphs[0]!;
    const lastPara = paragraphs[paragraphs.length - 1]!;
    const startChar = contentStart + firstPara.startOffset;
    const endChar = contentStart + lastPara.startOffset + lastPara.text.length;
    const text = paragraphs.map((p) => p.text).join('\n\n');

    return {
      leafId: this.generateLeafId(docUri, startChar, endChar),
      docUri,
      nodeId: node.nodeId,
      headingPath: node.headingPath,
      startChar,
      endChar,
      text,
      textHash: crypto.createHash('sha256').update(text).digest('hex'),
      shardId,
      tokenCount: this.tokenCounter(text),
    };
  }

  private generateLeafId(docUri: string, startChar: number, endChar: number): string {
    return crypto.createHash('sha256').update(`${docUri}:${startChar}:${endChar}`).digest('hex').slice(0, 16);
  }
}

