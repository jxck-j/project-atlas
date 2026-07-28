import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts deliberately: the app's Vite config carries
// build-only concerns (manualChunks for the production bundle) that have no
// meaning for the test runner, and merging them via mergeConfig would mean
// every future build-only tweak needs a "does this affect tests" check.
// Tests here are plain Node — nothing under test touches the DOM (they're
// the pure-function/math layer per Plan.md's Phase 1), so jsdom isn't
// needed and would only slow the suite down.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
