#!/usr/bin/env node
// build-chrome: builds the package you upload to the Chrome Web Store.
//
//   node tools/build-chrome.mjs            writes web-ext-artifacts/at-peace-<version>-chrome.zip
//
// The shipped manifest is Firefox-first. Chrome gets the same variant the e2e tests run
// (tests/e2e/harness.mjs): `background.scripts` becomes `background.service_worker` =
// src/background/sw-chrome.js (which importScripts() the very same files), and
// `browser_specific_settings` (Firefox-only) goes. Everything else ships unchanged.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set([join(ROOT, 'icons/icon.svg')]);

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
manifest.background = { service_worker: 'src/background/sw-chrome.js' };
delete manifest.browser_specific_settings;
manifest.minimum_chrome_version = '120';

const stage = await mkdtemp(join(tmpdir(), 'at-peace-chrome-'));
try {
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const dir of ['icons', 'src']) {
    await cp(join(ROOT, dir), join(stage, dir), { recursive: true, filter: (src) => !SKIP.has(src) && !/\.md$/i.test(src) });
  }
  const out = join(ROOT, 'web-ext-artifacts');
  await mkdir(out, { recursive: true });
  const file = join(out, `at-peace-${manifest.version}-chrome.zip`);
  await rm(file, { force: true });
  const zip = spawnSync('zip', ['-qrX', file, '.', '-x', '.*'], { cwd: stage, stdio: 'inherit' });
  if (zip.status !== 0) throw new Error('zip failed');
  console.log(`Ready to upload to the Chrome Web Store: web-ext-artifacts/at-peace-${manifest.version}-chrome.zip`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
