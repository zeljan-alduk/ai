// esbuild bundle for the VS Code extension. Runs in node, externalises
// the `vscode` module (provided by the host), produces a single CJS
// bundle that can be loaded by VS Code's main process.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  treeShaking: true,
  legalComments: 'none',
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild] watching…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[esbuild] built dist/extension.js');
}
