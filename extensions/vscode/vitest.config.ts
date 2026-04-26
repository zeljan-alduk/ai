import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Mock the `vscode` module — it's only available inside a real
    // electron host. For unit tests we provide a tiny shim under
    // `tests/vscode-mock.ts` and alias it here.
    alias: {
      vscode: new URL('./tests/vscode-mock.ts', import.meta.url).pathname,
    },
  },
});
