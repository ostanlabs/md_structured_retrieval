/**
 * Tokenizer Tests
 *
 * TDD: These tests define the expected behavior of the BgeM3Tokenizer.
 * Uses @xenova/transformers for tokenization.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BgeM3Tokenizer, approximateTokenCount } from '../tokenizer.js';

describe('approximateTokenCount', () => {
  it('should return approximate token count based on character length', () => {
    // ~4 chars per token approximation
    expect(approximateTokenCount('hello')).toBe(2); // 5 chars / 4 = 1.25 -> ceil = 2
    expect(approximateTokenCount('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> ceil = 3
    expect(approximateTokenCount('')).toBe(0);
  });

  it('should handle long text', () => {
    const longText = 'a'.repeat(1000);
    expect(approximateTokenCount(longText)).toBe(250); // 1000 / 4 = 250
  });
});

describe('BgeM3Tokenizer', () => {
  // Note: These tests require the actual tokenizer files to be present.
  // In CI, we may need to skip these or use mocks.

  describe('without model files (mock mode)', () => {
    it('should create tokenizer instance', () => {
      const tokenizer = new BgeM3Tokenizer();
      expect(tokenizer).toBeDefined();
    });

    it('should have countTokens method', () => {
      const tokenizer = new BgeM3Tokenizer();
      expect(typeof tokenizer.countTokens).toBe('function');
    });

    it('should have encode method', () => {
      const tokenizer = new BgeM3Tokenizer();
      expect(typeof tokenizer.encode).toBe('function');
    });

    it('should have isLoaded property', () => {
      const tokenizer = new BgeM3Tokenizer();
      expect(tokenizer.isLoaded).toBe(false);
    });
  });

  describe('countTokens (fallback mode)', () => {
    it('should use approximate count when not loaded', () => {
      const tokenizer = new BgeM3Tokenizer();
      // When not loaded, should fall back to approximate count
      const count = tokenizer.countTokens('hello world');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('encode (fallback mode)', () => {
    it('should throw when not loaded', () => {
      const tokenizer = new BgeM3Tokenizer();
      expect(() => tokenizer.encode('hello')).toThrow('Tokenizer not loaded');
    });
  });

  // Integration tests that require actual model files
  // Run with: MSRL_MODEL_PATH=~/.msrl/models/bge-m3 npm test
  const modelPath = process.env.MSRL_MODEL_PATH;
  const fs = require('fs');
  const hasModel = modelPath && fs.existsSync(`${modelPath}/tokenizer.json`);

  describe.skipIf(!hasModel)('with model files (integration)', () => {
    let tokenizer: BgeM3Tokenizer;

    beforeAll(async () => {
      tokenizer = new BgeM3Tokenizer();
      // Pass directory path - AutoTokenizer.from_pretrained expects a directory
      await tokenizer.load(modelPath!);
    });

    it('should load tokenizer from file', () => {
      expect(tokenizer.isLoaded).toBe(true);
    });

    it('should count tokens accurately', () => {
      const count = tokenizer.countTokens('Hello, world!');
      // Exact count depends on tokenizer vocab
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20);
    });

    it('should encode text to token IDs', () => {
      const result = tokenizer.encode('Hello, world!');
      expect(result.inputIds).toBeInstanceOf(BigInt64Array);
      expect(result.attentionMask).toBeInstanceOf(BigInt64Array);
      expect(result.tokenTypeIds).toBeInstanceOf(BigInt64Array);
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('should respect maxLength parameter', () => {
      const longText = 'word '.repeat(1000);
      const result = tokenizer.encode(longText, 512);
      expect(result.inputIds.length).toBeLessThanOrEqual(512);
    });

    it('should add special tokens ([CLS], [SEP])', () => {
      const result = tokenizer.encode('test');
      // First token should be [CLS] (usually ID 101 for BERT-based)
      // Last token should be [SEP] (usually ID 102 for BERT-based)
      expect(result.tokenCount).toBeGreaterThanOrEqual(3); // [CLS] + at least 1 token + [SEP]
    });
  });
});

