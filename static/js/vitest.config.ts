import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'cobertura'],
      reportsDirectory: './coverage',
      include: ['**/*.ts'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'coverage/**',
        'vitest.config.ts',
        'vite.config.ts',
        'app.ts',
        'login.ts',
        'list-utils.ts',
        'validation-config.ts',
        'domain-constants.ts',
        'components/card.ts',
      ]
    }
  }
});
