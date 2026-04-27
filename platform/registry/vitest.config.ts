import { defineConfig } from 'vitest/config';

// Postgres-backed tests use @electric-sql/pglite; first-test cold start
// (loading WASM, applying migrations including 002_breakpoints) consumes
// most of the default 5s vitest timeout. Bumping to 30s matches the
// storage / engine packages.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    environment: 'node',
  },
});
