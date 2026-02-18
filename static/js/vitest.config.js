import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['filters.js', 'state.js', 'utils.js', 'permissions.js', 'components/board.js', 'components/modal.js', 'components/tasks.js', 'components/backlog.js', 'components/planning.js', 'components/archive.js', 'components/setup.js'],
      exclude: ['tests/**', 'node_modules/**', 'coverage/**']
    }
  }
});
