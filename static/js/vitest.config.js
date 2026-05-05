import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'cobertura'],
      reportsDirectory: './coverage',
      include: ['**/*.js'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'coverage/**',
        'vendor/**',
        'vitest.config.js',
        'app.js',
        'login.js',
        'list-utils.js',
        'validation-config.js',
        'domain-constants.js',
        'components/card.js',
      ]
    }
  }
});
