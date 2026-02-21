/**
 * Tests for Logger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, setGlobalLogLevel, getGlobalLogLevel, type LogLevel } from '../logger';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setGlobalLogLevel('debug'); // Enable all logs for testing
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setGlobalLogLevel('info'); // Reset to default
  });

  describe('createLogger', () => {
    it('should create a logger with component name', () => {
      const logger = createLogger('TestComponent');
      expect(logger).toBeDefined();
      expect(logger.debug).toBeInstanceOf(Function);
      expect(logger.info).toBeInstanceOf(Function);
      expect(logger.warn).toBeInstanceOf(Function);
      expect(logger.error).toBeInstanceOf(Function);
    });
  });

  describe('log output format', () => {
    it('should write structured JSON to stderr', () => {
      const logger = createLogger('TestComponent');
      logger.info('Test message');

      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.level).toBe('info');
      expect(parsed.component).toBe('TestComponent');
      expect(parsed.msg).toBe('Test message');
      expect(parsed.ts).toBeDefined();
    });

    it('should include ISO timestamp', () => {
      const logger = createLogger('TestComponent');
      const before = new Date().toISOString();
      logger.info('Test message');
      const after = new Date().toISOString();

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.ts >= before).toBe(true);
      expect(parsed.ts <= after).toBe(true);
    });

    it('should include data when provided', () => {
      const logger = createLogger('TestComponent');
      logger.info('Test message', { key: 'value', count: 42 });

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.data).toEqual({ key: 'value', count: 42 });
    });

    it('should not include data field when not provided', () => {
      const logger = createLogger('TestComponent');
      logger.info('Test message');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.data).toBeUndefined();
    });
  });

  describe('log levels', () => {
    it('should log debug messages', () => {
      const logger = createLogger('TestComponent');
      logger.debug('Debug message');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('debug');
    });

    it('should log info messages', () => {
      const logger = createLogger('TestComponent');
      logger.info('Info message');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('info');
    });

    it('should log warn messages', () => {
      const logger = createLogger('TestComponent');
      logger.warn('Warn message');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('warn');
    });

    it('should log error messages', () => {
      const logger = createLogger('TestComponent');
      logger.error('Error message');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('error');
    });
  });

  describe('log level filtering', () => {
    it('should filter debug when level is info', () => {
      setGlobalLogLevel('info');
      const logger = createLogger('TestComponent');
      logger.debug('Debug message');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should allow info when level is info', () => {
      setGlobalLogLevel('info');
      const logger = createLogger('TestComponent');
      logger.info('Info message');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('should filter debug and info when level is warn', () => {
      setGlobalLogLevel('warn');
      const logger = createLogger('TestComponent');
      logger.debug('Debug message');
      logger.info('Info message');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should allow warn when level is warn', () => {
      setGlobalLogLevel('warn');
      const logger = createLogger('TestComponent');
      logger.warn('Warn message');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('should only allow error when level is error', () => {
      setGlobalLogLevel('error');
      const logger = createLogger('TestComponent');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.error('Error message');
      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe('getGlobalLogLevel', () => {
    it('should return current log level', () => {
      setGlobalLogLevel('warn');
      expect(getGlobalLogLevel()).toBe('warn');
    });
  });
});

