/**
 * File Watcher Tests
 *
 * TDD: These tests define the expected behavior of the file watcher
 * that monitors vault changes and triggers reindexing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileWatcher, WatcherConfig, FileChangeEvent } from '../file-watcher.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileWatcher', () => {
  let tmpDir: string;
  let watcher: FileWatcher;
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-watcher-test-'));
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createFile(relativePath: string, content: string = 'test'): void {
    const fullPath = path.join(tmpDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  describe('start/stop', () => {
    it('should start watching', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);
      expect(watcher.isWatching()).toBe(true);
    });

    it('should stop watching', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);
      await watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should be idempotent for multiple starts', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);
      await watcher.start(mockOnChange);
      expect(watcher.isWatching()).toBe(true);
    });

    it('should be idempotent for multiple stops', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);
      await watcher.stop();
      await watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe('file change detection', () => {
    it('should detect new markdown files', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      // Wait for watcher to be ready
      await new Promise((r) => setTimeout(r, 100));

      createFile('new.md', 'content');
      await new Promise((r) => setTimeout(r, 500));

      expect(mockOnChange).toHaveBeenCalled();
      const events = mockOnChange.mock.calls[0][0] as FileChangeEvent[];
      expect(events.some((e) => e.type === 'add' && e.docUri === 'new.md')).toBe(true);
    });

    it('should detect modified files', async () => {
      createFile('existing.md', 'original');
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      await new Promise((r) => setTimeout(r, 100));
      createFile('existing.md', 'modified content');
      await new Promise((r) => setTimeout(r, 300));

      expect(mockOnChange).toHaveBeenCalled();
      const events = mockOnChange.mock.calls[0][0] as FileChangeEvent[];
      expect(events.some((e) => e.type === 'change' && e.docUri === 'existing.md')).toBe(true);
    });

    it('should detect deleted files', async () => {
      createFile('delete-me.md', 'content');
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      await new Promise((r) => setTimeout(r, 100));
      fs.unlinkSync(path.join(tmpDir, 'delete-me.md'));
      await new Promise((r) => setTimeout(r, 300));

      expect(mockOnChange).toHaveBeenCalled();
      const events = mockOnChange.mock.calls[0][0] as FileChangeEvent[];
      expect(events.some((e) => e.type === 'unlink' && e.docUri === 'delete-me.md')).toBe(true);
    });

    it('should ignore non-markdown files', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      createFile('image.png', 'binary');
      await new Promise((r) => setTimeout(r, 300));

      // Should not trigger callback for non-md files
      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('debouncing', () => {
    it('should batch rapid changes', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 100 });
      await watcher.start(mockOnChange);

      // Create multiple files rapidly
      createFile('a.md');
      createFile('b.md');
      createFile('c.md');

      await new Promise((r) => setTimeout(r, 400));

      // Should be called once with all changes batched
      expect(mockOnChange).toHaveBeenCalledTimes(1);
      const events = mockOnChange.mock.calls[0][0] as FileChangeEvent[];
      expect(events.length).toBe(3);
    });
  });

  describe('exclusions', () => {
    it('should ignore .obsidian directory', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      createFile('.obsidian/config.json', '{}');
      await new Promise((r) => setTimeout(r, 150));

      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should ignore hidden files', async () => {
      watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
      await watcher.start(mockOnChange);

      createFile('.hidden.md', 'content');
      await new Promise((r) => setTimeout(r, 150));

      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });
});

