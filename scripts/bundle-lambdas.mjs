/**
 * Bundle all Lambda handlers into deployable zip-ready directories.
 *
 * Each handler is bundled with esbuild into `dist-lambda/<name>/index.js`
 * exporting `handler` (matches the CDK `handler: 'index.handler'` config).
 *
 * AWS SDK v3 clients are kept external (provided by the Lambda Node 20 runtime).
 * `sharp` is kept external for the thumbnail handler — it ships native binaries
 * and is provided via a Lambda layer or installed separately.
 *
 * Usage: node scripts/bundle-lambdas.mjs
 */

import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** @type {{ name: string, entry: string, external: string[] }[]} */
const targets = [
  {
    name: 'api',
    entry: 'packages/api/src/lambda.ts',
    external: [],
  },
  {
    name: 'thumbnail',
    entry: 'packages/lambdas/src/thumbnail/handler.ts',
    // sharp ships native binaries — cannot be bundled; provide via layer/runtime
    external: ['sharp'],
  },
  {
    name: 'virus-scan',
    entry: 'packages/lambdas/src/virus-scan/handler.ts',
    external: [],
  },
  {
    name: 'lifecycle',
    entry: 'packages/lambdas/src/lifecycle/handler.ts',
    external: [],
  },
  {
    name: 'post-signup',
    entry: 'packages/lambdas/src/post-signup/handler.ts',
    external: [],
  },
];

const outRoot = resolve(root, 'dist-lambda');
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const target of targets) {
  const outdir = resolve(outRoot, target.name);
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: [resolve(root, target.entry)],
    outfile: resolve(outdir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: true,
    // AWS SDK v3 is bundled into the Node 20 Lambda runtime
    external: ['@aws-sdk/*', ...target.external],
    logLevel: 'info',
  });

  console.log(`✓ Bundled ${target.name} -> dist-lambda/${target.name}/index.js`);
}

console.log('\nAll Lambda handlers bundled successfully.');
