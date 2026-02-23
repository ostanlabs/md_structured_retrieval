import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // Allow require() for synchronous loading in specific cases
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-case-declarations': 'off',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  {
    // Disable type-aware linting for test files (not in tsconfig)
    files: ['**/__tests__/**/*.ts', '**/setup.ts'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.js', '*.cjs', '*.mjs', 'scripts/**'],
  }
);

