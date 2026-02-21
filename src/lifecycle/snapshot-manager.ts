/**
 * Snapshot Manager - Handles snapshot lifecycle
 *
 * Manages snapshot creation, activation, validation, and cleanup.
 * Supports rollback to previous snapshots.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type SnapshotState = 'building' | 'active' | 'inactive';

export interface SnapshotInfo {
  id: string;
  path: string;
  state: SnapshotState;
  createdAt: number;
}

interface SnapshotMeta {
  id: string;
  state: SnapshotState;
  createdAt: number;
}

const SNAPSHOTS_DIR = 'snapshots';
const META_FILE = 'meta.json';

export class SnapshotManager {
  private basePath: string;
  private snapshotsPath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.snapshotsPath = path.join(basePath, SNAPSHOTS_DIR);
    fs.mkdirSync(this.snapshotsPath, { recursive: true });
  }

  createSnapshot(): SnapshotInfo {
    const id = this.generateId();
    const snapshotPath = path.join(this.snapshotsPath, id);
    fs.mkdirSync(snapshotPath, { recursive: true });

    const meta: SnapshotMeta = {
      id,
      state: 'building',
      createdAt: Date.now(),
    };
    this.writeMeta(id, meta);

    return { id, path: snapshotPath, state: 'building', createdAt: meta.createdAt };
  }

  activateSnapshot(id: string): void {
    const info = this.getSnapshotInfo(id);
    if (!info) {
      throw new Error(`Snapshot not found: ${id}`);
    }

    // Deactivate current active snapshot
    const current = this.getActiveSnapshot();
    if (current && current.id !== id) {
      this.updateState(current.id, 'inactive');
    }

    this.updateState(id, 'active');
  }

  getActiveSnapshot(): SnapshotInfo | null {
    const snapshots = this.listSnapshots();
    return snapshots.find((s) => s.state === 'active') || null;
  }

  getSnapshotInfo(id: string): SnapshotInfo | null {
    const snapshotPath = path.join(this.snapshotsPath, id);
    const metaPath = path.join(snapshotPath, META_FILE);

    if (!fs.existsSync(metaPath)) {
      return null;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SnapshotMeta;
    return { id: meta.id, path: snapshotPath, state: meta.state, createdAt: meta.createdAt };
  }

  deleteSnapshot(id: string): void {
    const info = this.getSnapshotInfo(id);
    if (!info) {
      return;
    }

    if (info.state === 'active') {
      throw new Error('Cannot delete active snapshot');
    }

    fs.rmSync(info.path, { recursive: true, force: true });
  }

  listSnapshots(): SnapshotInfo[] {
    if (!fs.existsSync(this.snapshotsPath)) {
      return [];
    }

    const entries = fs.readdirSync(this.snapshotsPath, { withFileTypes: true });
    const snapshots: SnapshotInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const info = this.getSnapshotInfo(entry.name);
        if (info) {
          snapshots.push(info);
        }
      }
    }

    // Sort by creation time descending (newest first)
    snapshots.sort((a, b) => b.createdAt - a.createdAt);
    return snapshots;
  }

  cleanupOldSnapshots(keepCount: number): void {
    const snapshots = this.listSnapshots();
    const activeId = this.getActiveSnapshot()?.id;

    // Keep active + keepCount most recent
    let kept = 0;
    for (const snapshot of snapshots) {
      if (snapshot.id === activeId) {
        continue; // Never delete active
      }
      if (kept < keepCount) {
        kept++;
        continue;
      }
      this.deleteSnapshot(snapshot.id);
    }
  }

  rollback(): void {
    const snapshots = this.listSnapshots();
    const activeIdx = snapshots.findIndex((s) => s.state === 'active');

    if (activeIdx === -1 || activeIdx >= snapshots.length - 1) {
      throw new Error('No previous snapshot to rollback to');
    }

    const previous = snapshots[activeIdx + 1]!;
    this.activateSnapshot(previous.id);
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `${timestamp}-${random}`;
  }

  private writeMeta(id: string, meta: SnapshotMeta): void {
    const metaPath = path.join(this.snapshotsPath, id, META_FILE);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  private updateState(id: string, state: SnapshotState): void {
    const info = this.getSnapshotInfo(id);
    if (!info) return;

    const meta: SnapshotMeta = { id, state, createdAt: info.createdAt };
    this.writeMeta(id, meta);
  }
}

