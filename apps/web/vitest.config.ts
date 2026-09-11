import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default (existing pure unit tests). DOM suites opt into jsdom
    // per file via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
