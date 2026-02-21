/**
 * File Scanner Tests
 *
 * TDD: These tests define the expected behavior of the file scanner
 * that discovers markdown files in a vault and detects changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileScanner, FileInfo, ScanResult } from '../file-scanner.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileScanner', () => {
  let tmpDir: string;
  let scanner: FileScanner;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-scanner-test-'));
    scanner = new FileScanner(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createFile(relativePath: string, content: string = 'test'): void {
    const fullPath = path.join(tmpDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  describe('scan()', () => {
    it('should return empty result for empty vault', () => {
      const result = scanner.scan();
      expect(result.files).toEqual([]);
    });

    it('should find markdown files in root', () => {
      createFile('note.md');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
      expect(result.files[0]!.docUri).toBe('note.md');
    });

    it('should find markdown files in subdirectories', () => {
      createFile('notes/daily/2024-01-15.md');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
      expect(result.files[0]!.docUri).toBe('notes/daily/2024-01-15.md');
    });

    it('should ignore non-markdown files', () => {
      createFile('note.md');
      createFile('image.png');
      createFile('data.json');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
    });

    it('should include file size and mtime', () => {
      createFile('note.md', 'Hello, world!');
      const result = scanner.scan();
      expect(result.files[0]!.size).toBe(13);
      expect(result.files[0]!.mtimeMs).toBeGreaterThan(0);
    });

    it('should exclude .obsidian directory', () => {
      createFile('note.md');
      createFile('.obsidian/config.json');
      createFile('.obsidian/plugins/test/main.js');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
    });

    it('should exclude hidden files and directories', () => {
      createFile('note.md');
      createFile('.hidden.md');
      createFile('.hidden/note.md');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
    });

    it('should exclude node_modules', () => {
      createFile('note.md');
      createFile('node_modules/package/readme.md');
      const result = scanner.scan();
      expect(result.files.length).toBe(1);
    });

    it('should use POSIX paths (forward slashes)', () => {
      createFile('notes/daily/2024-01-15.md');
      const result = scanner.scan();
      expect(result.files[0]!.docUri).not.toContain('\\');
      expect(result.files[0]!.docUri).toBe('notes/daily/2024-01-15.md');
    });
  });

  describe('detectChanges()', () => {
    it('should detect new files', () => {
      createFile('note.md');
      const current = scanner.scan();

      createFile('new.md');
      const newScan = scanner.scan();

      const changes = scanner.detectChanges(current.files, newScan.files);
      expect(changes.added.length).toBe(1);
      expect(changes.added[0]!.docUri).toBe('new.md');
      expect(changes.modified.length).toBe(0);
      expect(changes.deleted.length).toBe(0);
    });

    it('should detect deleted files', () => {
      createFile('note.md');
      createFile('delete-me.md');
      const current = scanner.scan();

      fs.unlinkSync(path.join(tmpDir, 'delete-me.md'));
      const newScan = scanner.scan();

      const changes = scanner.detectChanges(current.files, newScan.files);
      expect(changes.added.length).toBe(0);
      expect(changes.modified.length).toBe(0);
      expect(changes.deleted.length).toBe(1);
      expect(changes.deleted[0]).toBe('delete-me.md');
    });

    it('should detect modified files by mtime', async () => {
      createFile('note.md', 'original');
      const current = scanner.scan();

      // Wait a bit to ensure mtime changes
      await new Promise((r) => setTimeout(r, 50));
      createFile('note.md', 'modified content');
      const newScan = scanner.scan();

      const changes = scanner.detectChanges(current.files, newScan.files);
      expect(changes.added.length).toBe(0);
      expect(changes.modified.length).toBe(1);
      expect(changes.modified[0]!.docUri).toBe('note.md');
      expect(changes.deleted.length).toBe(0);
    });

    it('should detect modified files by size', () => {
      createFile('note.md', 'short');
      const current = scanner.scan();

      // Modify with same mtime but different size (simulate)
      const file = current.files[0]!;
      const newFiles: FileInfo[] = [
        { ...file, size: file.size + 100 },
      ];

      const changes = scanner.detectChanges(current.files, newFiles);
      expect(changes.modified.length).toBe(1);
    });
  });
});

