/**
 * Snapshot Manager Tests
 *
 * TDD: These tests define the expected behavior of the snapshot manager
 * that handles snapshot activation, validation, and rollback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotManager, SnapshotInfo, SnapshotState } from '../snapshot-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SnapshotManager', () => {
  let tmpDir: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msrl-snapshot-test-'));
    manager = new SnapshotManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSnapshot()', () => {
    it('should create a new snapshot directory', () => {
      const snapshot = manager.createSnapshot();
      expect(snapshot.id).toBeTruthy();
      expect(fs.existsSync(snapshot.path)).toBe(true);
    });

    it('should generate unique snapshot IDs', () => {
      const s1 = manager.createSnapshot();
      const s2 = manager.createSnapshot();
      expect(s1.id).not.toBe(s2.id);
    });

    it('should set initial state to building', () => {
      const snapshot = manager.createSnapshot();
      expect(snapshot.state).toBe('building');
    });
  });

  describe('activateSnapshot()', () => {
    it('should mark snapshot as active', () => {
      const snapshot = manager.createSnapshot();
      manager.activateSnapshot(snapshot.id);

      const info = manager.getSnapshotInfo(snapshot.id);
      expect(info?.state).toBe('active');
    });

    it('should deactivate previous active snapshot', () => {
      const s1 = manager.createSnapshot();
      manager.activateSnapshot(s1.id);

      const s2 = manager.createSnapshot();
      manager.activateSnapshot(s2.id);

      const info1 = manager.getSnapshotInfo(s1.id);
      const info2 = manager.getSnapshotInfo(s2.id);

      expect(info1?.state).toBe('inactive');
      expect(info2?.state).toBe('active');
    });

    it('should throw for non-existent snapshot', () => {
      expect(() => manager.activateSnapshot('nonexistent')).toThrow();
    });
  });

  describe('getActiveSnapshot()', () => {
    it('should return null when no active snapshot', () => {
      expect(manager.getActiveSnapshot()).toBeNull();
    });

    it('should return the active snapshot', () => {
      const snapshot = manager.createSnapshot();
      manager.activateSnapshot(snapshot.id);

      const active = manager.getActiveSnapshot();
      expect(active?.id).toBe(snapshot.id);
    });
  });

  describe('deleteSnapshot()', () => {
    it('should remove snapshot directory', () => {
      const snapshot = manager.createSnapshot();
      const snapshotPath = snapshot.path;

      manager.deleteSnapshot(snapshot.id);

      expect(fs.existsSync(snapshotPath)).toBe(false);
    });

    it('should not allow deleting active snapshot', () => {
      const snapshot = manager.createSnapshot();
      manager.activateSnapshot(snapshot.id);

      expect(() => manager.deleteSnapshot(snapshot.id)).toThrow();
    });
  });

  describe('listSnapshots()', () => {
    it('should return empty array when no snapshots', () => {
      expect(manager.listSnapshots()).toEqual([]);
    });

    it('should list all snapshots', () => {
      manager.createSnapshot();
      manager.createSnapshot();
      manager.createSnapshot();

      const snapshots = manager.listSnapshots();
      expect(snapshots.length).toBe(3);
    });

    it('should sort by creation time descending', async () => {
      const s1 = manager.createSnapshot();
      await new Promise((r) => setTimeout(r, 10));
      const s2 = manager.createSnapshot();
      await new Promise((r) => setTimeout(r, 10));
      const s3 = manager.createSnapshot();

      const snapshots = manager.listSnapshots();
      expect(snapshots[0]!.id).toBe(s3.id);
      expect(snapshots[2]!.id).toBe(s1.id);
    });
  });

  describe('cleanupOldSnapshots()', () => {
    it('should keep specified number of snapshots', () => {
      for (let i = 0; i < 5; i++) {
        manager.createSnapshot();
      }

      manager.cleanupOldSnapshots(2);

      expect(manager.listSnapshots().length).toBe(2);
    });

    it('should never delete active snapshot', () => {
      const s1 = manager.createSnapshot();
      manager.activateSnapshot(s1.id);

      for (let i = 0; i < 5; i++) {
        manager.createSnapshot();
      }

      manager.cleanupOldSnapshots(2);

      const active = manager.getActiveSnapshot();
      expect(active?.id).toBe(s1.id);
    });
  });

  describe('rollback()', () => {
    it('should activate previous snapshot', async () => {
      const s1 = manager.createSnapshot();
      manager.activateSnapshot(s1.id);

      await new Promise((r) => setTimeout(r, 10));
      const s2 = manager.createSnapshot();
      manager.activateSnapshot(s2.id);

      manager.rollback();

      const active = manager.getActiveSnapshot();
      expect(active?.id).toBe(s1.id);
    });

    it('should throw when no previous snapshot', () => {
      const s1 = manager.createSnapshot();
      manager.activateSnapshot(s1.id);

      expect(() => manager.rollback()).toThrow();
    });
  });
});

