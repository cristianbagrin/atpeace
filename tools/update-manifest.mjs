#!/usr/bin/env node
// update-manifest: keeps updates.json, the Firefox update manifest that tells an installed At Peace
// where the newest signed .xpi is. The file lives in the public repo cristianbagrin/at-peace-updates;
// manifest.json's browser_specific_settings.gecko.update_url points at it.
//
//   node tools/update-manifest.mjs --file updates.json --xpi xpi/at-peace-0.2.0.xpi
//   node tools/update-manifest.mjs --file updates.json --version 0.2.0 --sha256 <hex> [--link <url>] [--id <addon id>]
//
// --version and --id default to the ones in this repo's manifest.json, --link to the raw.githubusercontent
// URL of xpi/at-peace-<version>.xpi in the updates repo. With --xpi the sha256 is computed from that file.
// The release workflow (.github/workflows/release.yml) is the only caller.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The public repo that holds only the signed .xpi files and updates.json. */
export const UPDATES_REPO = 'cristianbagrin/at-peace-updates';
export const UPDATES_BRANCH = 'main';
/** What manifest.json's `update_url` must be. */
export const UPDATE_URL = `https://raw.githubusercontent.com/${UPDATES_REPO}/${UPDATES_BRANCH}/updates.json`;

/** Where the signed file for a version is published (path inside the updates repo). */
export const xpiPath = (version) => `xpi/at-peace-${version}.xpi`;
/** Its public download URL; this is the `update_link` Firefox follows. */
export const xpiLink = (version) => `https://raw.githubusercontent.com/${UPDATES_REPO}/${UPDATES_BRANCH}/${xpiPath(version)}`;

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Numeric compare of dotted versions: negative when a < b. Missing or odd parts count as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** "abc…" or "sha256:abc…" (any case) to 64 lower-case hex digits; throws on anything else. */
export function normalizeSha256(value) {
  const hex = String(value ?? '').trim().replace(/^sha256:/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`sha256 must be 64 hex digits, got "${value}"`);
  return hex;
}

/**
 * Adds one release to an update manifest and returns the new manifest object (the input is not changed).
 *
 * - `existingJson` is the current updates.json as text or as an object; empty / null starts a new one.
 * - Older entries stay, other add-on ids stay, entries are ordered oldest to newest.
 * - Adding a version that is already listed replaces that entry (a re-run never makes a duplicate).
 *
 * @param {string | object | null | undefined} existingJson
 * @param {{ id: string, version: string, link: string, sha256: string }} release
 * @returns {{ addons: Record<string, { updates: { version: string, update_link: string, update_hash: string }[] }> }}
 */
export function addRelease(existingJson, { id, version, link, sha256 }) {
  if (typeof id !== 'string' || id === '') throw new Error('add-on id is required');
  if (!VERSION_RE.test(String(version))) throw new Error(`version must look like 1.2.3, got "${version}"`);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`update link is not a URL: "${link}"`);
  }
  if (url.protocol !== 'https:') throw new Error(`update link must be https, got "${link}"`);
  const hash = normalizeSha256(sha256);

  let manifest;
  if (existingJson == null || (typeof existingJson === 'string' && existingJson.trim() === '')) manifest = {};
  else if (typeof existingJson === 'string') {
    try {
      manifest = JSON.parse(existingJson);
    } catch (err) {
      throw new Error(`existing updates.json is not valid JSON: ${err.message}`, { cause: err });
    }
  } else manifest = structuredClone(existingJson);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('existing updates.json must be a JSON object');

  manifest.addons ??= {};
  if (typeof manifest.addons !== 'object' || Array.isArray(manifest.addons)) throw new Error('"addons" in updates.json must be an object');
  const addon = (manifest.addons[id] ??= {});
  if (addon.updates !== undefined && !Array.isArray(addon.updates)) throw new Error(`"addons.${id}.updates" in updates.json must be an array`);

  const updates = (addon.updates ?? []).filter((u) => u?.version !== version);
  updates.push({ version, update_link: link, update_hash: `sha256:${hash}` });
  updates.sort((a, b) => compareVersions(a.version, b.version));
  addon.updates = updates;
  return manifest;
}

/** The text written to updates.json: two-space JSON and a final newline. */
export const formatManifest = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      xpi: { type: 'string' },
      sha256: { type: 'string' },
      version: { type: 'string' },
      id: { type: 'string' },
      link: { type: 'string' },
    },
    strict: true,
  });
  if (!values.file || (!values.xpi && !values.sha256)) {
    console.error('Usage: node tools/update-manifest.mjs --file <updates.json> (--xpi <file.xpi> | --sha256 <hex>) [--version x.y.z] [--id <add-on id>] [--link <url>]');
    process.exit(2);
  }
  const source = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const id = values.id ?? source.browser_specific_settings?.gecko?.id;
  const version = values.version ?? source.version;
  const sha256 = values.sha256 ?? createHash('sha256').update(await readFile(values.xpi)).digest('hex');
  const link = values.link ?? xpiLink(version);

  const file = resolve(values.file);
  let existing = '';
  try {
    existing = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const manifest = addRelease(existing, { id, version, link, sha256 });
  await writeFile(file, formatManifest(manifest));
  const count = manifest.addons[id].updates.length;
  console.log(`${values.file}: ${id} ${version} sha256:${normalizeSha256(sha256)}`);
  console.log(`  ${link}`);
  console.log(`  ${count} release${count === 1 ? '' : 's'} listed, newest last`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`update-manifest: ${err.message}`);
    process.exit(1);
  });
}
