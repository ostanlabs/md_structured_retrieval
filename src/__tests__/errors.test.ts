/**
 * Tests for MsrlError class and error utilities.
 */

import { describe, it, expect } from 'vitest';
import { MsrlError } from '../types';
import {
  invalidArgument,
  notFound,
  notIndexed,
  indexBusy,
  indexCorrupt,
  ioError,
  modelDownloadFailed,
  internalError,
  isMsrlError,
} from '../errors';

describe('MsrlError', () => {
  describe('basic functionality', () => {
    it('should create error with code and message', () => {
      const error = new MsrlError('INVALID_ARGUMENT', 'Invalid query');
      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toBe('Invalid query');
      expect(error.name).toBe('MsrlError');
      expect(error.details).toBeUndefined();
    });

    it('should create error with details', () => {
      const error = new MsrlError('INVALID_ARGUMENT', 'Invalid query', {
        field: 'query',
        value: '',
        reason: 'Query cannot be empty',
      });
      expect(error.details).toEqual({
        field: 'query',
        value: '',
        reason: 'Query cannot be empty',
      });
    });

    it('should be instanceof Error', () => {
      const error = new MsrlError('INTERNAL', 'Something went wrong');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MsrlError);
    });

    it('should have proper stack trace', () => {
      const error = new MsrlError('INTERNAL', 'Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('MsrlError');
    });
  });

  describe('isMsrlError', () => {
    it('should return true for MsrlError instances', () => {
      const error = new MsrlError('INTERNAL', 'Test');
      expect(isMsrlError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');
      expect(isMsrlError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isMsrlError(null)).toBe(false);
      expect(isMsrlError(undefined)).toBe(false);
      expect(isMsrlError('error')).toBe(false);
      expect(isMsrlError({ code: 'INTERNAL' })).toBe(false);
    });
  });
});

describe('Error factory functions', () => {
  describe('invalidArgument', () => {
    it('should create INVALID_ARGUMENT error with details', () => {
      const error = invalidArgument('query', '', 'Query cannot be empty');
      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toContain('query');
      expect(error.details).toEqual({
        field: 'query',
        value: '',
        reason: 'Query cannot be empty',
      });
    });

    it('should include valid options when provided', () => {
      const error = invalidArgument('mode', 'invalid', 'Invalid mode', ['hybrid', 'vector', 'bm25']);
      expect(error.details?.validOptions).toEqual(['hybrid', 'vector', 'bm25']);
    });
  });

  describe('notFound', () => {
    it('should create NOT_FOUND error for document', () => {
      const error = notFound('notes/missing.md');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toContain('notes/missing.md');
      expect(error.details).toEqual({ docUri: 'notes/missing.md' });
    });

    it('should include heading path when provided', () => {
      const error = notFound('notes/doc.md', 'Section → Missing');
      expect(error.details).toEqual({
        docUri: 'notes/doc.md',
        headingPath: 'Section → Missing',
      });
    });
  });

  describe('notIndexed', () => {
    it('should create NOT_INDEXED error', () => {
      const error = notIndexed();
      expect(error.code).toBe('NOT_INDEXED');
      expect(error.message).toContain('not indexed');
      expect(error.details).toEqual({});
    });
  });

  describe('indexBusy', () => {
    it('should create INDEX_BUSY error with timestamp', () => {
      const startedAt = new Date('2024-01-15T10:30:00Z');
      const error = indexBusy(startedAt);
      expect(error.code).toBe('INDEX_BUSY');
      expect(error.message).toContain('in progress');
      expect(error.details).toEqual({
        currentBuildStartedAt: startedAt.toISOString(),
      });
    });
  });

  describe('indexCorrupt', () => {
    it('should create INDEX_CORRUPT error', () => {
      const error = indexCorrupt('snap-123', 'Missing FAISS index');
      expect(error.code).toBe('INDEX_CORRUPT');
      expect(error.message).toContain('corrupt');
      expect(error.details).toEqual({
        snapshotId: 'snap-123',
        reason: 'Missing FAISS index',
      });
    });

    it('should include missing files when provided', () => {
      const error = indexCorrupt('snap-123', 'Missing files', ['shard-0.faiss', 'shard-1.faiss']);
      expect(error.details?.missingFiles).toEqual(['shard-0.faiss', 'shard-1.faiss']);
    });
  });

  describe('ioError', () => {
    it('should create IO_ERROR error', () => {
      const error = ioError('/path/to/file.md', 'read');
      expect(error.code).toBe('IO_ERROR');
      expect(error.message).toContain('/path/to/file.md');
      expect(error.details).toEqual({
        path: '/path/to/file.md',
        operation: 'read',
      });
    });

    it('should include errno when provided', () => {
      const error = ioError('/path/to/file.md', 'read', 'ENOENT');
      expect(error.details?.errno).toBe('ENOENT');
    });
  });

  describe('modelDownloadFailed', () => {
    it('should create MODEL_DOWNLOAD_FAILED error', () => {
      const error = modelDownloadFailed('https://huggingface.co/model', 'Network timeout');
      expect(error.code).toBe('MODEL_DOWNLOAD_FAILED');
      expect(error.message).toContain('download');
      expect(error.details).toEqual({
        url: 'https://huggingface.co/model',
        reason: 'Network timeout',
      });
    });
  });

  describe('internalError', () => {
    it('should create INTERNAL error', () => {
      const error = internalError('Unexpected state');
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toBe('Unexpected state');
      expect(error.details).toEqual({});
    });

    it('should include original error when provided', () => {
      const original = new Error('Original error');
      const error = internalError('Wrapped error', original);
      expect(error.details?.originalError).toBe(original.message);
    });
  });
});
