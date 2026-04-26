// Optional E2E entry-point for `@vscode/test-electron`. Downloads a
// VS Code build and runs the extension in a real host. We don't run
// this in the inner CI loop (it pulls ~120MB of electron) but ship
// the harness so the launch checklist can flip it on.
//
// Usage: pnpm --filter aldo-ai-vscode test:e2e
const path = require('node:path');

async function main() {
  const { runTests } = require('@vscode/test-electron');
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, './e2e-suite.cjs');
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
