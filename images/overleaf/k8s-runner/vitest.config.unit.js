import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/js/**/*.test.js'],
    restoreMocks: true,
    testNamePattern: process.env.TEST_NAME_PATTERN || undefined,
  },
})
