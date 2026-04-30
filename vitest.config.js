import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest runs server unit tests; Playwright owns e2e/.
    include: ['server/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
