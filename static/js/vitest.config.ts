import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Before each test, every mock goes back to the implementation it was created with, so a
    // value one test sets with mockReturnValue/mockResolvedValue cannot leak into the next.
    mockReset: true,
    // Every run uses a new test order, so a test that depends on an earlier one fails soon.
    // A failure that only shows in some orders is repeated with the seed the run prints.
    sequence: { shuffle: true },
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
