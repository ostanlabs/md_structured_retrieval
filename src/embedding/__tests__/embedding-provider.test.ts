/**
 * EmbeddingProvider Tests
 *
 * TDD: These tests define the expected behavior of the embedding provider.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  EmbeddingProvider,
  EmbeddingResult,
  l2Normalize,
  cosineSimilarity,
} from '../embedding-provider.js';

describe('l2Normalize', () => {
  it('should normalize a vector to unit length', () => {
    const vector = new Float32Array([3, 4]); // 3-4-5 triangle
    const normalized = l2Normalize(vector);

    // Should have unit length
    const length = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
    expect(length).toBeCloseTo(1.0, 5);

    // Should preserve direction
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });

  it('should handle zero vector', () => {
    const vector = new Float32Array([0, 0, 0]);
    const normalized = l2Normalize(vector);

    // Zero vector stays zero
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(0);
    expect(normalized[2]).toBe(0);
  });

  it('should handle already normalized vector', () => {
    const vector = new Float32Array([1, 0, 0]);
    const normalized = l2Normalize(vector);

    expect(normalized[0]).toBeCloseTo(1.0, 5);
    expect(normalized[1]).toBeCloseTo(0.0, 5);
    expect(normalized[2]).toBeCloseTo(0.0, 5);
  });

  it('should handle high-dimensional vectors', () => {
    const dim = 1024;
    const vector = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      vector[i] = Math.random();
    }

    const normalized = l2Normalize(vector);

    // Check unit length
    let sumSquares = 0;
    for (let i = 0; i < dim; i++) {
      sumSquares += normalized[i]! ** 2;
    }
    expect(Math.sqrt(sumSquares)).toBeCloseTo(1.0, 4);
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical normalized vectors', () => {
    const v1 = l2Normalize(new Float32Array([1, 2, 3]));
    const v2 = l2Normalize(new Float32Array([1, 2, 3]));

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const v1 = l2Normalize(new Float32Array([1, 0, 0]));
    const v2 = l2Normalize(new Float32Array([0, 1, 0]));

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const v1 = l2Normalize(new Float32Array([1, 0, 0]));
    const v2 = l2Normalize(new Float32Array([-1, 0, 0]));

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
  });

  it('should be symmetric', () => {
    const v1 = l2Normalize(new Float32Array([1, 2, 3]));
    const v2 = l2Normalize(new Float32Array([4, 5, 6]));

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(cosineSimilarity(v2, v1), 5);
  });
});

describe('EmbeddingProvider interface', () => {
  it('should define required properties', () => {
    // This is a type-level test - if it compiles, the interface is correct
    const mockProvider: EmbeddingProvider = {
      modelName: 'test-model',
      dimension: 1024,
      initialize: async () => {},
      embed: async (text: string) => ({
        vector: new Float32Array(1024),
        tokenCount: 10,
      }),
      embedBatch: async (texts: string[]) =>
        texts.map(() => ({
          vector: new Float32Array(1024),
          tokenCount: 10,
        })),
      countTokens: (text: string) => Math.ceil(text.length / 4),
      dispose: async () => {},
    };

    expect(mockProvider.modelName).toBe('test-model');
    expect(mockProvider.dimension).toBe(1024);
  });
});

describe('EmbeddingResult', () => {
  it('should have correct structure', () => {
    const result: EmbeddingResult = {
      vector: new Float32Array(1024),
      tokenCount: 42,
    };

    expect(result.vector).toBeInstanceOf(Float32Array);
    expect(result.vector.length).toBe(1024);
    expect(result.tokenCount).toBe(42);
  });
});

// Integration tests that require actual model files
// Run with: MSRL_MODEL_PATH=~/.msrl/models/bge-m3 npm test
import { OnnxBgeM3Provider } from '../onnx-bge-m3-provider.js';
import * as fs from 'fs';
import * as path from 'path';

const modelPath = process.env.MSRL_MODEL_PATH;
const hasModel =
  modelPath &&
  fs.existsSync(path.join(modelPath, 'model.onnx')) &&
  fs.existsSync(path.join(modelPath, 'tokenizer.json'));

describe.skipIf(!hasModel)('OnnxBgeM3Provider (integration)', () => {
  let provider: OnnxBgeM3Provider;

  beforeAll(async () => {
    provider = new OnnxBgeM3Provider({
      modelPath: path.join(modelPath!, 'model.onnx'),
      tokenizerPath: modelPath!,
      maxSequenceLength: 8192,
      numThreads: 4,
    });
    await provider.initialize();
  }, 60000); // 60s timeout for model loading

  afterAll(async () => {
    await provider.dispose();
  });

  it('should have correct model name', () => {
    expect(provider.modelName).toBe('bge-m3-int8');
  });

  it('should have correct dimension', () => {
    expect(provider.dimension).toBe(1024);
  });

  it('should embed text and return normalized vector', async () => {
    const result = await provider.embed('Hello, world!');

    expect(result.vector).toBeInstanceOf(Float32Array);
    expect(result.vector.length).toBe(1024);
    expect(result.tokenCount).toBeGreaterThan(0);

    // Check normalization (L2 norm should be ~1)
    let sumSquares = 0;
    for (let i = 0; i < result.vector.length; i++) {
      sumSquares += result.vector[i]! ** 2;
    }
    expect(Math.sqrt(sumSquares)).toBeCloseTo(1.0, 3);
  });

  it('should produce similar embeddings for similar text', async () => {
    const result1 = await provider.embed('The cat sat on the mat');
    const result2 = await provider.embed('A cat was sitting on a mat');
    const result3 = await provider.embed('Quantum physics is complex');

    const sim12 = cosineSimilarity(result1.vector, result2.vector);
    const sim13 = cosineSimilarity(result1.vector, result3.vector);

    // Similar sentences should have higher similarity
    expect(sim12).toBeGreaterThan(sim13);
    expect(sim12).toBeGreaterThan(0.7); // High similarity
    expect(sim13).toBeLessThan(0.5); // Low similarity
  });

  it('should embed batch of texts', async () => {
    const texts = ['Hello', 'World', 'Test'];
    const results = await provider.embedBatch(texts);

    expect(results.length).toBe(3);
    for (const result of results) {
      expect(result.vector.length).toBe(1024);
      expect(result.tokenCount).toBeGreaterThan(0);
    }
  });

  it('should count tokens accurately', () => {
    const count = provider.countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });
});
