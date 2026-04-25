import { defineConfig } from 'vitest/config';

// pglite cold-start + applying all storage migrations (incl. the wave-5
// breakpoints migration) reliably exceeds the default 10s hook timeout
// on slower CI runners. Bump both the per-test and per-hook caps to
// 30s so beforeAll(setupTestEnv) has headroom.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
  },
});
