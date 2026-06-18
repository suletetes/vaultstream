/**
 * Deploy the sharp Lambda Layer and attach it to the thumbnail function.
 *
 * Publishes `dist-lambda/layers/sharp-layer.zip` as a Lambda layer version,
 * then updates the thumbnail function to use it.
 *
 * Usage:
 *   node scripts/deploy-sharp-layer.mjs --prefix vaultstream-dev --region us-east-1
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const zipPath = resolve(root, 'dist-lambda', 'layers', 'sharp-layer.zip');
if (!existsSync(zipPath)) {
  console.error('Error: sharp-layer.zip not found. Run "node scripts/build-sharp-layer.mjs" first.');
  process.exit(1);
}

const layerName = `${prefix}-sharp`;
const functionName = `${prefix}-thumbnail`;

console.log(`Publishing layer: ${layerName}`);

const publishOutput = execSync(
  `aws lambda publish-layer-version --layer-name "${layerName}" --zip-file "fileb://${zipPath}" --compatible-runtimes nodejs20.x --compatible-architectures x86_64 --region ${region} --no-cli-pager --output json`,
  { encoding: 'utf8' },
);

const layerVersionArn = JSON.parse(publishOutput).LayerVersionArn;
console.log(`✓ Published layer version: ${layerVersionArn}`);

console.log(`Attaching layer to ${functionName}...`);

execSync(
  `aws lambda update-function-configuration --function-name "${functionName}" --layers "${layerVersionArn}" --region ${region} --no-cli-pager`,
  { stdio: 'inherit' },
);

// Wait for update to propagate
execSync(
  `aws lambda wait function-updated --function-name "${functionName}" --region ${region}`,
  { stdio: 'inherit' },
);

console.log(`✓ Layer attached to ${functionName}`);
