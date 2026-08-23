// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Ignored paths ───────────────────────────────────────────────────────────
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'coverage/**',
      'generated/**',
      'prisma/migrations/**',
    ],
  },

  // ── Base rule sets ──────────────────────────────────────────────────────────
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,

  // ── Language options ────────────────────────────────────────────────────────
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Project rules ───────────────────────────────────────────────────────────
  {
    rules: {
      // ── TypeScript ───────────────────────────────────────────────────────

      // NestJS uses 'any' in decorators and metadata — keep off globally.
      '@typescript-eslint/no-explicit-any': 'off',

      // Unhandled promise rejections are silent bugs; warn so they're visible.
      '@typescript-eslint/no-floating-promises': 'warn',

      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Enforce `import type` for type-only imports so isolatedModules + tsc
      // can strip them safely without needing type information at emit time.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Prefix unused variables/args with _ to silence the warning intentionally.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ── Unsafe access (downgraded from recommendedTypeChecked error) ─────────
      //
      // NestJS uses `any` in decorator metadata, platform adapters, and guard
      // signatures (e.g. ThrottlerGuard.getTracker takes Record<string, any>).
      // Error level produces noise that hides real bugs; warn keeps them visible.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      // ── General ──────────────────────────────────────────────────────────

      // Use AppLoggerService instead of console in application code.
      // Disable locally with // eslint-disable-next-line no-console in scripts.
      'no-console': 'warn',
    },
  },

  // ── Test file overrides ─────────────────────────────────────────────────────
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      // jest-mock-extended mock methods are jest.fn() instances — they don't
      // use `this`, so the unbound-method check is a false positive in tests.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
