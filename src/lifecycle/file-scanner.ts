/**
 * File Scanner - Discovers markdown files in a vault
 *
 * Recursively scans a vault directory to find all markdown files,
 * excluding hidden files, .obsidian, and node_modules.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  docUri: string; // Vault-relative POSIX path
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: FileInfo[];
}

export interface ChangeSet {
  added: FileInfo[];
  modified: FileInfo[];
  deleted: string[]; // docUri of deleted files
}

const EXCLUDED_DIRS = new Set(['.obsidian', 'node_modules', '.git', '.trash']);

export class FileScanner {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Scan the vault and return all markdown files.
   */
  scan(): ScanResult {
    const files: FileInfo[] = [];
    this.scanDir('', files);
    return { files };
  }

  /**
   * Detect changes between two scan results.
   */
  detectChanges(previous: FileInfo[], current: FileInfo[]): ChangeSet {
    const prevMap = new Map<string, FileInfo>();
    for (const f of previous) {
      prevMap.set(f.docUri, f);
    }

    const currMap = new Map<string, FileInfo>();
    for (const f of current) {
      currMap.set(f.docUri, f);
    }

    const added: FileInfo[] = [];
    const modified: FileInfo[] = [];
    const deleted: string[] = [];

    // Find added and modified
    for (const curr of current) {
      const prev = prevMap.get(curr.docUri);
      if (!prev) {
        added.push(curr);
      } else if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size) {
        modified.push(curr);
      }
    }

    // Find deleted
    for (const prev of previous) {
      if (!currMap.has(prev.docUri)) {
        deleted.push(prev.docUri);
      }
    }

    return { added, modified, deleted };
  }

  private scanDir(relativePath: string, files: FileInfo[]): void {
    const fullPath = path.join(this.vaultPath, relativePath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch {
      return; // Directory doesn't exist or can't be read
    }

    for (const entry of entries) {
      const name = entry.name;

      // Skip hidden files/directories
      if (name.startsWith('.')) {
        continue;
      }

      // Skip excluded directories
      if (entry.isDirectory() && EXCLUDED_DIRS.has(name)) {
        continue;
      }

      const entryRelPath = relativePath ? `${relativePath}/${name}` : name;

      if (entry.isDirectory()) {
        this.scanDir(entryRelPath, files);
      } else if (entry.isFile() && name.endsWith('.md')) {
        const entryFullPath = path.join(fullPath, name);
        try {
          const stat = fs.statSync(entryFullPath);
          files.push({
            docUri: entryRelPath, // Already POSIX (using /)
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // File was deleted between readdir and stat
        }
      }
    }
  }
}

