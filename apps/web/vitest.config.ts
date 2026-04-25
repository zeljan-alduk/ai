/**
 * Vitest config for @aldo-ai/web.
 *
 * Tests live alongside the modules they cover (e.g.
 * `lib/session.test.ts`, `app/(auth)/schemas.test.ts`). Node
 * environment is fine for everything we run here — we mock fetch and
 * `next/headers` directly rather than spinning up a JSDOM browser
 * environment.
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'components/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
});
