// Build extension → dist/ (load unpacked trong chrome://extensions hoặc coccoc://extensions)
//   node scripts/build.mjs           build 1 lần
//   node scripts/build.mjs --watch   build lại khi sửa code
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'public'), dist, { recursive: true });

const options = {
  entryPoints: {
    background: resolve(root, 'src/background/index.ts'),
    'content/runner': resolve(root, 'src/content/runner.ts'),
    'popup/popup': resolve(root, 'src/popup/popup.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
