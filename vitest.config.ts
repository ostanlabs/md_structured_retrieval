import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globalSetup: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'dist',
        '**/__tests__/**',
        '**/*.d.ts',
      ],
    },
    testTimeout: 30000, // 30s for tests involving model loading
    hookTimeout: 60000, // 60s for setup/teardown with model download
  },
});

