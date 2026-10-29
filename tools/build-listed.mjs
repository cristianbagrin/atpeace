#!/usr/bin/env node
// build-listed: builds the package you upload to addons.mozilla.org (AMO) for the public, listed add-on.
//
//   node tools/build-listed.mjs            writes web-ext-artifacts/at-peace-<version>-listed.zip
//
// It is the same extension as the self-distributed one, except that manifest.json has no `update_url`:
// AMO refuses a listed version that carries one (it updates listed add-ons itself). Everything else is
// copied untouched, with the same files left out as in web-ext-config.mjs. The result is checked with
// plain `web-ext lint` (not --self-hosted), which is what AMO applies to a listed version.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Left out of the package (see web-ext-config.mjs).
const SKIP = new Set([join(ROOT, 'src/background/sw-chrome.js'), join(ROOT, 'icons/icon.svg')]);

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
delete manifest.browser_specific_settings?.gecko?.update_url;

const stage = await mkdtemp(join(tmpdir(), 'at-peace-listed-'));
try {
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const dir of ['icons', 'src']) {
    await cp(join(ROOT, dir), join(stage, dir), { recursive: true, filter: (src) => !SKIP.has(src) });
  }
  const out = join(ROOT, 'web-ext-artifacts');
  await mkdir(out, { recursive: true });
  const webExt = (args) => spawnSync('npx', ['web-ext', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (webExt(['lint', '--source-dir', stage]).status !== 0) throw new Error('web-ext lint failed on the listed package');
  const filename = `at-peace-${manifest.version}-listed.zip`;
  if (webExt(['build', '--source-dir', stage, '--artifacts-dir', out, '--filename', filename, '--overwrite-dest']).status !== 0) {
    throw new Error('web-ext build failed');
  }
  console.log(`\nReady to upload to addons.mozilla.org: web-ext-artifacts/${filename}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
