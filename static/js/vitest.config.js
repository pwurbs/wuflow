import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'cobertura'],
      reportsDirectory: './coverage',
      include: ['filters.js', 'state.js', 'utils.js', 'permissions.js', 'markdown.js', 'components/board.js', 'components/modal.js', 'components/tasks.js', 'components/backlog.js', 'components/planning.js', 'components/archive.js', 'components/system-settings.js', 'components/project-settings.js', 'components/toolbar.js'],
      exclude: ['tests/**', 'node_modules/**', 'coverage/**']
    }
  }
});
