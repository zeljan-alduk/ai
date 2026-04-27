import { defineConfig } from 'vitest/config';

// Sweep runner spawns Runtime.spawn for each (case, model) cell. Even with
// a mock gateway, async iteration over RunEvents and Promise scheduling
// can dominate the default 5s vitest budget when a sweep grows past a few
// cells. 30s matches the engine + registry packages.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    environment: 'node',
  },
});
