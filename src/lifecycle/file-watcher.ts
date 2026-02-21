/**
 * File Watcher - Monitors vault for changes
 *
 * Uses chokidar to watch for file changes and triggers callbacks
 * with debounced, batched change events.
 */

import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';

export interface WatcherConfig {
  debounceMs: number;
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  docUri: string;
}

export type ChangeCallback = (events: FileChangeEvent[]) => void;

const DEFAULT_CONFIG: WatcherConfig = {
  debounceMs: 300,
};

export class FileWatcher {
  private vaultPath: string;
  private config: WatcherConfig;
  private watcher: FSWatcher | null = null;
  private pendingEvents: FileChangeEvent[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private callback: ChangeCallback | null = null;

  constructor(vaultPath: string, config: Partial<WatcherConfig> = {}) {
    this.vaultPath = vaultPath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(callback: ChangeCallback): Promise<void> {
    if (this.watcher) {
      return; // Already watching
    }

    this.callback = callback;

    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: [
        /(^|[\/\\])\../, // Hidden files/directories
        '**/node_modules/**',
        '**/.obsidian/**',
        '**/.git/**',
        '**/.trash/**',
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath) => this.handleEvent('add', filePath));
    this.watcher.on('change', (filePath) => this.handleEvent('change', filePath));
    this.watcher.on('unlink', (filePath) => this.handleEvent('unlink', filePath));

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve);
    });
  }

  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    await this.watcher.close();
    this.watcher = null;
    this.callback = null;
    this.pendingEvents = [];
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  private handleEvent(type: 'add' | 'change' | 'unlink', filePath: string): void {
    // Only process markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }

    // Convert to vault-relative POSIX path
    const relativePath = path.relative(this.vaultPath, filePath);
    const docUri = relativePath.split(path.sep).join('/');

    // Skip hidden files (double-check)
    if (docUri.startsWith('.') || docUri.includes('/.')) {
      return;
    }

    this.pendingEvents.push({ type, docUri });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.config.debounceMs);
  }

  private flush(): void {
    if (this.pendingEvents.length === 0 || !this.callback) {
      return;
    }

    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    this.debounceTimer = null;

    this.callback(events);
  }
}

