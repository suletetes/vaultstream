/**
 * Deploy bundled Lambda code to AWS by updating each function's code.
 *
 * Reads bundles from `dist-lambda/<name>/` (produced by bundle-lambdas.mjs),
 * zips each one, and calls `aws lambda update-function-code` for the matching
 * function `<prefix>-<name>`.
 *
 * Requires AWS credentials in the environment (configured by the CI OIDC step).
 *
 * Usage:
 *   node scripts/deploy-lambda-code.mjs --prefix vaultstream-dev --region us-east-1
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const prefix = getArg('--prefix', process.env.ENV_PREFIX || 'vaultstream-dev');
const region = getArg('--region', process.env.AWS_REGION || 'us-east-1');

// bundle dir name -> Lambda function suffix (function name = `${prefix}-${suffix}`)
const functions = ['api', 'thumbnail', 'virus-scan', 'lifecycle', 'post-signup'];

const outRoot = resolve(root, 'dist-lambda');

function zipDir(dir, zipPath) {
  // Use the cross-platform `zip` on Linux/macOS (CI runs ubuntu-latest).
  // The bundle contents must be at the zip root (index.js, index.js.map).
  execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: dir, stdio: 'inherit' });
}

let updated = 0;
for (const name of functions) {
  const dir = resolve(outRoot, name);
  if (!existsSync(dir) || !readdirSync(dir).includes('index.js')) {
    console.warn(`⚠ Skipping ${name}: no bundle found at dist-lambda/${name}`);
    continue;
  }

  const functionName = `${prefix}-${name}`;
  const zipPath = resolve(outRoot, `${name}.zip`);

  console.log(`Packaging ${name} -> ${zipPath}`);
  zipDir(dir, zipPath);

  console.log(`Updating function code: ${functionName}`);
  execFileSync(
    'aws',
    [
      'lambda',
      'update-function-code',
      '--function-name',
      functionName,
      '--zip-file',
      `fileb://${zipPath}`,
      '--region',
      region,
      '--no-cli-pager',
    ],
    { stdio: 'inherit' },
  );

  // Wait until the update has propagated before moving on.
  execFileSync(
    'aws',
    ['lambda', 'wait', 'function-updated', '--function-name', functionName, '--region', region],
    { stdio: 'inherit' },
  );

  updated += 1;
  console.log(`✓ Updated ${functionName}\n`);
}

console.log(`Done. Updated ${updated} Lambda function(s).`);
