/**
 * MsrlEngine - Top-level orchestrator for MSRL.
 *
 * This is the main entry point for the MSRL library. It coordinates:
 * - Embedding provider initialization
 * - Snapshot management (build, load, swap)
 * - Query execution via retrieval pipeline
 * - File watching for incremental updates
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { MsrlConfig, MsrlConfigInput } from './config.js';
import { parseConfig } from './config.js';
import type {
  IndexStatus,
  ReindexResult,
  WatchResult,
  QueryResult as TypesQueryResult,
  SearchResult as TypesSearchResult,
} from './types.js';
import { MsrlError } from './types.js';
import { invalidArgument, notIndexed, indexBusy, internalError } from './errors.js';
import { createLogger, setGlobalLogLevel, type LogLevel } from './logger.js';
import { SnapshotManager, type SnapshotInfo } from './lifecycle/snapshot-manager.js';
import { SnapshotBuilder, type BuildResult } from './lifecycle/snapshot-builder.js';
import { FileScanner, type FileInfo } from './lifecycle/file-scanner.js';
import { FileWatcher, type FileChangeEvent } from './lifecycle/file-watcher.js';
import { RetrievalPipeline, type QueryResult, type SearchResult } from './retrieval/retrieval-pipeline.js';
import type { EmbeddingProvider } from './embedding/embedding-provider.js';
import { MetadataStore } from './store/metadata-store.js';
import { Bm25Index } from './store/bm25-index.js';

const logger = createLogger('MsrlEngine');

/**
 * Query parameters for MsrlEngine.query().
 */
export interface EngineQueryParams {
  query: string;
  topK?: number;
  maxExcerptChars?: number;
  filters?: {
    /** Filter to documents whose URI starts with this prefix */
    docUriPrefix?: string;
    /** Filter to specific document URIs (exact match) */
    docUris?: string[];
    /** Filter to headings whose path starts with this prefix */
    headingPathPrefix?: string;
    /** Filter to headings whose path contains this substring (case-insensitive) */
    headingPathContains?: string;
  };
  debug?: {
    includeScores?: boolean;
    includeShardsSearched?: boolean;
  };
}

/**
 * Reindex parameters for engine.reindex().
 */
export interface EngineReindexParams {
  /** If true, wait for build to complete. If false, return immediately. */
  wait?: boolean;
  /** If true, force full rebuild even if incremental is possible. */
  force?: boolean;
}

/**
 * Watch parameters for engine.setWatch().
 */
export interface EngineWatchParams {
  enabled: boolean;
  debounceMs?: number;
}

/**
 * Loaded snapshot with all resources.
 */
interface LoadedSnapshot {
  id: string;
  metadataStore: MetadataStore;
  bm25Index: Bm25Index;
  pipeline: RetrievalPipeline;
  stats: {
    docs: number;
    nodes: number;
    leaves: number;
    shards: number;
  };
  createdAt: Date;
}

export class MsrlEngine {
  private config: MsrlConfig;
  private snapshotManager: SnapshotManager;
  private embeddingProvider: EmbeddingProvider | null = null;
  private currentSnapshot: LoadedSnapshot | null = null;
  private fileWatcher: FileWatcher | null = null;
  private buildLock: boolean = false;
  private buildStartedAt: Date | null = null;

  private constructor(config: MsrlConfig) {
    this.config = config;
    this.snapshotManager = new SnapshotManager(path.join(config.vaultRoot, '.msrl'));
  }

  /**
   * Factory method to create and initialize an MsrlEngine.
   * Accepts partial config - only vaultRoot is required, all other fields use defaults.
   */
  static async create(inputConfig: MsrlConfigInput): Promise<MsrlEngine> {
    // Parse and validate config with defaults applied
    const config = parseConfig(inputConfig);

    // Set log level
    setGlobalLogLevel(config.logLevel as LogLevel);
    logger.info('Creating MsrlEngine', { vaultRoot: config.vaultRoot });

    // Validate vault path
    await MsrlEngine.validateVaultPath(config.vaultRoot);

    // Ensure .msrl directory exists
    const msrlPath = path.join(config.vaultRoot, '.msrl');
    await fs.mkdir(msrlPath, { recursive: true });

    const engine = new MsrlEngine(config);

    // Initialize embedding provider
    await engine.initializeEmbeddingProvider();

    // Try to load existing snapshot
    await engine.loadLatestSnapshot();

    // Start file watcher if configured
    if (config.watcher.enabled) {
      await engine.startWatcher();
    }

    // If no snapshot exists, trigger initial build
    if (!engine.currentSnapshot) {
      logger.info('No existing snapshot found, triggering initial build');
      await engine.reindex({ wait: true });
    }

    logger.info('MsrlEngine created successfully');
    return engine;
  }

  private static async validateVaultPath(vaultRoot: string): Promise<void> {
    try {
      const stat = await fs.stat(vaultRoot);
      if (!stat.isDirectory()) {
        throw invalidArgument('vaultRoot', vaultRoot, 'Path is not a directory');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw invalidArgument('vaultRoot', vaultRoot, 'Path does not exist');
      }
      if (error instanceof MsrlError) {
        throw error;
      }
      throw internalError('Failed to validate vault path', error as Error);
    }
  }

  private async initializeEmbeddingProvider(): Promise<void> {
    // TODO: Initialize ONNX BGE-M3 provider
    // For now, this is a placeholder
    logger.info('Initializing embedding provider');
  }

  private async loadLatestSnapshot(): Promise<void> {
    const snapshots = await this.snapshotManager.listSnapshots();
    const activeSnapshot = snapshots.find((s: SnapshotInfo) => s.state === 'active');

    if (activeSnapshot) {
      await this.loadSnapshot(activeSnapshot);
    }
  }

  private async loadSnapshot(info: SnapshotInfo): Promise<void> {
    logger.info('Loading snapshot', { id: info.id });
    // TODO: Load metadata store, BM25 index, create pipeline
    // For now, this is a placeholder
  }

  private async startWatcher(): Promise<void> {
    if (this.fileWatcher) {
      return;
    }

    logger.info('Starting file watcher');
    this.fileWatcher = new FileWatcher(this.config.vaultRoot, {
      debounceMs: this.config.watcher.debounceMs,
    });

    this.fileWatcher.start((events: FileChangeEvent[]) => {
      this.handleFileChanges(events);
    });
  }

  private async stopWatcher(): Promise<void> {
    if (this.fileWatcher) {
      logger.info('Stopping file watcher');
      await this.fileWatcher.stop();
      this.fileWatcher = null;
    }
  }

  private handleFileChanges(events: FileChangeEvent[]): void {
    logger.debug('File changes detected', { count: events.length });
    // Trigger incremental reindex
    this.reindex({ wait: false }).catch((error) => {
      logger.error('Failed to reindex after file changes', { error: String(error) });
    });
  }

  /**
   * Execute a hybrid search query.
   */
  async query(params: EngineQueryParams): Promise<TypesQueryResult> {
    if (!this.currentSnapshot) {
      throw notIndexed();
    }

    if (!params.query || !params.query.trim()) {
      throw invalidArgument('query', params.query, 'Query cannot be empty');
    }

    const topK = params.topK ?? this.config.retrieval.defaultTopK;
    const maxExcerptChars = params.maxExcerptChars ?? this.config.retrieval.defaultMaxExcerptChars;

    // Validate topK
    if (topK < 1 || topK > this.config.retrieval.maxTopK) {
      throw invalidArgument('topK', topK, `Must be between 1 and ${this.config.retrieval.maxTopK}`);
    }

    // Validate maxExcerptChars
    if (maxExcerptChars < 200 || maxExcerptChars > this.config.retrieval.maxMaxExcerptChars) {
      throw invalidArgument(
        'maxExcerptChars',
        maxExcerptChars,
        `Must be between 200 and ${this.config.retrieval.maxMaxExcerptChars}`,
      );
    }

    logger.debug('Executing query', { query: params.query, topK, maxExcerptChars });

    const result = await this.currentSnapshot.pipeline.query({
      query: params.query,
      limit: topK,
      filter: params.filters
        ? {
            docUriPrefix: params.filters.docUriPrefix,
            docUris: params.filters.docUris,
            headingPathPrefix: params.filters.headingPathPrefix,
            headingPathContains: params.filters.headingPathContains,
          }
        : undefined,
    });

    return {
      results: result.results as TypesSearchResult[],
      meta: {
        tookMs: result.meta.tookMs,
      },
    };
  }

  /**
   * Trigger a reindex operation.
   */
  async reindex(params: EngineReindexParams = {}): Promise<ReindexResult> {
    const wait = params.wait ?? true;

    // Check if build is in progress
    if (this.buildLock) {
      if (!wait) {
        throw indexBusy(this.buildStartedAt!);
      }
      // Wait for current build to complete
      logger.info('Waiting for current build to complete');
      await this.waitForBuild();
    }

    // Start new build
    this.buildLock = true;
    this.buildStartedAt = new Date();

    if (!wait) {
      // Start build in background
      this.runBuild(params.force ?? false).catch((error) => {
        logger.error('Background build failed', { error: String(error) });
      });
      return { completed: false };
    }

    // Run build and wait
    const result = await this.runBuild(params.force ?? false);
    return result;
  }

  private async waitForBuild(): Promise<void> {
    while (this.buildLock) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async runBuild(force: boolean): Promise<ReindexResult> {
    const startTime = Date.now();
    logger.info('Starting build', { force });

    try {
      // Scan vault for files
      const scanner = new FileScanner(this.config.vaultRoot);
      const scanResult = scanner.scan();
      const files = scanResult.files;

      logger.info('Scanned vault', { fileCount: files.length });

      // Create new snapshot
      const snapshotInfo = await this.snapshotManager.createSnapshot();
      logger.info('Created snapshot', { id: snapshotInfo.id });

      // TODO: Build snapshot with SnapshotBuilder
      // For now, just activate the empty snapshot

      await this.snapshotManager.activateSnapshot(snapshotInfo.id);

      const buildTimeMs = Date.now() - startTime;
      logger.info('Build completed', { snapshotId: snapshotInfo.id, buildTimeMs });

      return {
        completed: true,
        snapshotId: snapshotInfo.id,
        stats: {
          docsAdded: files.length,
          docsModified: 0,
          docsDeleted: 0,
          buildTimeMs,
        },
      };
    } finally {
      this.buildLock = false;
      this.buildStartedAt = null;
    }
  }

  /**
   * Get current index status.
   */
  getStatus(): IndexStatus {
    const state = this.buildLock ? 'building' : this.currentSnapshot ? 'ready' : 'error';

    return {
      state,
      snapshotId: this.currentSnapshot?.id ?? null,
      snapshotTimestamp: this.currentSnapshot?.createdAt.toISOString() ?? null,
      stats: this.currentSnapshot?.stats ?? {
        docs: 0,
        nodes: 0,
        leaves: 0,
        shards: 0,
      },
      watcher: {
        enabled: this.fileWatcher !== null,
        debounceMs: this.config.watcher.debounceMs,
      },
    };
  }

  /**
   * Configure file watcher.
   */
  async setWatch(params: EngineWatchParams): Promise<WatchResult> {
    if (params.enabled && !this.fileWatcher) {
      await this.startWatcher();
    } else if (!params.enabled && this.fileWatcher) {
      await this.stopWatcher();
    }

    // Update debounce if provided
    if (params.debounceMs !== undefined && this.fileWatcher) {
      // FileWatcher doesn't support runtime debounce change,
      // so we need to restart it
      await this.stopWatcher();
      this.config.watcher.debounceMs = params.debounceMs;
      if (params.enabled) {
        await this.startWatcher();
      }
    }

    return {
      enabled: this.fileWatcher !== null,
      debounceMs: this.config.watcher.debounceMs,
    };
  }

  /**
   * Shutdown the engine and release all resources.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down MsrlEngine');

    // Stop watcher
    await this.stopWatcher();

    // Close current snapshot resources
    if (this.currentSnapshot) {
      this.currentSnapshot.metadataStore.close();
      this.currentSnapshot = null;
    }

    logger.info('MsrlEngine shutdown complete');
  }
}
