/**
 * Build a Lambda Layer containing sharp for linux-x64.
 *
 * Creates the layer structure at `dist-lambda/layers/sharp/`:
 *   nodejs/node_modules/sharp/...
 *
 * Then zips it as `dist-lambda/layers/sharp-layer.zip`.
 *
 * Usage: node scripts/build-sharp-layer.mjs
 *
 * NOTE: This installs the linux-x64 platform binaries regardless of the host OS,
 * so the layer works on Lambda even when built from Windows/macOS.
 */

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const layerDir = resolve(root, 'dist-lambda', 'layers', 'sharp', 'nodejs');
const zipPath = resolve(root, 'dist-lambda', 'layers', 'sharp-layer.zip');

// Clean previous build
rmSync(resolve(root, 'dist-lambda', 'layers', 'sharp'), { recursive: true, force: true });
mkdirSync(layerDir, { recursive: true });

console.log('Installing sharp for linux-x64...');

// Install sharp with the Linux platform override so native binaries work on Lambda
execSync(
  'npm init -y && npm install --os=linux --cpu=x64 sharp@0.33.5',
  {
    cwd: layerDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Force sharp to download linux-x64 binaries
      npm_config_platform: 'linux',
      npm_config_arch: 'x64',
    },
  },
);

// Remove package.json/package-lock.json (not needed in layer)
const pjson = resolve(layerDir, 'package.json');
const plock = resolve(layerDir, 'package-lock.json');
if (existsSync(pjson)) rmSync(pjson);
if (existsSync(plock)) rmSync(plock);

console.log('Zipping layer...');

const layerRoot = resolve(root, 'dist-lambda', 'layers', 'sharp');
// zip needs to run from the layer root so the path inside is `nodejs/node_modules/...`
if (process.platform === 'win32') {
  // On Windows, use PowerShell's Compress-Archive
  execSync(
    `powershell -Command "Compress-Archive -Path '${layerRoot}\\nodejs' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' },
  );
} else {
  execSync(`zip -r -q "${zipPath}" nodejs`, { cwd: layerRoot, stdio: 'inherit' });
}

console.log(`✓ Sharp layer built: dist-lambda/layers/sharp-layer.zip`);
