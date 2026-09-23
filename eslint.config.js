import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'db/migrations/**',
      'contracts/lib/**',
      // Local-only agent/assistant artifacts (gitignored, not repo code).
      '.opencode/**',
      '.claude/**',
      '.agents/**',
      'agent/**',
      'docs/phases/**',
      'docs/reports/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactPlugin.configs.flat.recommended,
    languageOptions: {
      ...reactPlugin.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', 'db/**/*.ts', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Repo tooling (committed scripts): Node runtime. Browser-context
    // globals used inside Playwright page.evaluate() callbacks are
    // declared per-file with /* global */ comments instead.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // F2 guard (accepted drizzle-orm CVE risk, GHSA-gpj5-g38j-94v9): the CVE
    // is unreachable only while no dynamic identifiers reach SQL. These
    // selectors forbid the sinks outright in shipped server code and DB
    // Tooling (migrations are generated DDL and already ignored above).
    // Legitimate static uses keep working: sql`` tagged templates (values
    // stay parameterized) and db.execute(sql`SELECT 1`) in db/verify.ts.
    files: ['apps/api/src/**/*.ts', 'db/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="sql"][callee.property.name="raw"]',
          message:
            'F2 guard: sql.raw() is forbidden — dynamic SQL fragments from user input would re-open GHSA-gpj5-g38j-94v9. Use static sql`` fragments with bound parameters.',
        },
        {
          selector: 'CallExpression[callee.object.name="sql"][callee.property.name="identifier"]',
          message:
            'F2 guard: sql.identifier() is forbidden — dynamic identifiers would re-open GHSA-gpj5-g38j-94v9. Identifiers must be static.',
        },
        {
          // Only untagged argument shapes are flagged: a static sql``
          // tagged template (with or without a <T> type argument, as in
          // db/verify.ts) never matches. Interpolated values inside sql``
          // stay parameterized; identifiers must be static (see above).
          selector:
            'CallExpression[callee.property.name="execute"] > Literal, CallExpression[callee.property.name="execute"] > Identifier, CallExpression[callee.property.name="execute"] > BinaryExpression, CallExpression[callee.property.name="execute"] > TemplateLiteral',
          message:
            'F2 guard: db.execute() accepts only a static sql`` tagged template — never a string, variable, or concatenation. Interpolated values inside sql`` stay parameterized.',
        },
        {
          selector: 'CallExpression[callee.property.name="where"] BinaryExpression[operator="+"]',
          message:
            'F2 guard: .where() must not be built from string concatenation — use drizzle column expressions with bound values.',
        },
      ],
    },
  },
);
