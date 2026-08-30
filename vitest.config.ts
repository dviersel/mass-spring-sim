import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // The simulation core has no browser dependency, so the tests need no DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
