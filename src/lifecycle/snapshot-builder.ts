/**
 * Snapshot Builder - Creates and updates search indexes
 *
 * Orchestrates the full indexing pipeline: parse → chunk → embed → store.
 * Supports both full rebuilds and incremental updates.
 */

import { FileInfo } from './file-scanner.js';

export interface BuildProgress {
  phase: 'parsing' | 'chunking' | 'embedding' | 'indexing' | 'complete';
  current: number;
  total: number;
  currentFile?: string;
}

export interface BuildStats {
  filesProcessed: number;
  filesFailed: number;
  chunksCreated: number;
  embeddingsCreated: number;
  embeddingsCached: number;
  tookMs: number;
}

export interface BuildResult {
  success: boolean;
  stats: BuildStats;
}

export interface ParseResult {
  tree: { children: unknown[] };
  leaves: Array<{ id: string; text: string }>;
}

export interface ChunkResult {
  leafId: string;
  text: string;
}

export interface EmbeddingResult {
  leafId: string;
  embedding: Float32Array;
}

export interface BuilderDependencies {
  parseFile: (docUri: string) => Promise<ParseResult>;
  chunkLeaves: (leaves: Array<{ id: string; text: string }>) => ChunkResult[];
  embed: (chunks: ChunkResult[]) => Promise<EmbeddingResult[]>;
  storeMetadata: (docUri: string, tree: unknown, leaves: unknown[]) => Promise<void>;
  indexBm25: (chunks: ChunkResult[]) => Promise<void>;
  indexVector: (embeddings: EmbeddingResult[]) => Promise<void>;
  getCachedEmbedding: (leafId: string) => Float32Array | null;
}

export class SnapshotBuilder {
  private deps: BuilderDependencies;

  constructor(deps: BuilderDependencies) {
    this.deps = deps;
  }

  async buildFull(
    files: FileInfo[],
    onProgress?: (progress: BuildProgress) => void
  ): Promise<BuildResult> {
    const startTime = Date.now();
    const stats: BuildStats = {
      filesProcessed: 0,
      filesFailed: 0,
      chunksCreated: 0,
      embeddingsCreated: 0,
      embeddingsCached: 0,
      tookMs: 0,
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      onProgress?.({ phase: 'parsing', current: i, total: files.length, currentFile: file.docUri });

      try {
        const { tree, leaves } = await this.deps.parseFile(file.docUri);
        const chunks = this.deps.chunkLeaves(leaves);
        stats.chunksCreated += chunks.length;

        // Embed all chunks (full build doesn't use cache)
        if (chunks.length > 0) {
          const embeddings = await this.deps.embed(chunks);
          stats.embeddingsCreated += embeddings.length;

          await this.deps.storeMetadata(file.docUri, tree, leaves);
          await this.deps.indexBm25(chunks);
          await this.deps.indexVector(embeddings);
        }

        stats.filesProcessed++;
      } catch {
        stats.filesFailed++;
      }
    }

    onProgress?.({ phase: 'complete', current: files.length, total: files.length });
    stats.tookMs = Date.now() - startTime;

    return { success: true, stats };
  }

  async buildIncremental(
    added: FileInfo[],
    modified: FileInfo[],
    deleted: string[],
    onProgress?: (progress: BuildProgress) => void
  ): Promise<BuildResult> {
    const startTime = Date.now();
    const stats: BuildStats = {
      filesProcessed: 0,
      filesFailed: 0,
      chunksCreated: 0,
      embeddingsCreated: 0,
      embeddingsCached: 0,
      tookMs: 0,
    };

    // Process added and modified files
    const filesToProcess = [...added, ...modified];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i]!;
      onProgress?.({
        phase: 'parsing',
        current: i,
        total: filesToProcess.length,
        currentFile: file.docUri,
      });

      try {
        const { tree, leaves } = await this.deps.parseFile(file.docUri);
        const chunks = this.deps.chunkLeaves(leaves);
        stats.chunksCreated += chunks.length;

        // Check cache for each chunk
        const chunksToEmbed: ChunkResult[] = [];
        const cachedEmbeddings: EmbeddingResult[] = [];

        for (const chunk of chunks) {
          const cached = this.deps.getCachedEmbedding(chunk.leafId);
          if (cached) {
            cachedEmbeddings.push({ leafId: chunk.leafId, embedding: cached });
            stats.embeddingsCached++;
          } else {
            chunksToEmbed.push(chunk);
          }
        }

        // Embed only new chunks
        let newEmbeddings: EmbeddingResult[] = [];
        if (chunksToEmbed.length > 0) {
          newEmbeddings = await this.deps.embed(chunksToEmbed);
          stats.embeddingsCreated += newEmbeddings.length;
        }

        const allEmbeddings = [...cachedEmbeddings, ...newEmbeddings];

        await this.deps.storeMetadata(file.docUri, tree, leaves);
        await this.deps.indexBm25(chunks);
        await this.deps.indexVector(allEmbeddings);

        stats.filesProcessed++;
      } catch {
        stats.filesFailed++;
      }
    }

    onProgress?.({ phase: 'complete', current: filesToProcess.length, total: filesToProcess.length });
    stats.tookMs = Date.now() - startTime;

    return { success: true, stats };
  }
}

