#!/usr/bin/env node
// amo-signed-file: downloads the file Mozilla already signed for a version, if there is one.
//
//   AMO_ISSUER=… AMO_SECRET=… node tools/amo-signed-file.mjs --version 0.2.0 --out web-ext-artifacts/at-peace-0.2.0.xpi
//
// Mozilla signs a version number once. When a release run signed a version and then failed later (or was run
// twice), signing again is refused; this fetches the signed file instead, so re-running the release finishes
// the job. Used by .github/workflows/release.yml before `web-ext sign`.
//
// Exit codes: 0 downloaded (sha256 checked against Mozilla's), 3 Mozilla has no such version (sign it),
// 4 Mozilla has the version but has not signed it (yet), 1 anything else.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { amoJwt } from './check-release-setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://addons.mozilla.org/api/v5';

export const NOT_FOUND = 3;
export const NOT_SIGNED = 4;

/** The version list URL for an add-on, unlisted versions included (needs the developer's credentials). */
export const versionsUrl = (addonId) => `${API}/addons/addon/${encodeURIComponent(addonId)}/versions/?filter=all_with_unlisted&page_size=50`;

/** The API has called it `file` (v5) and `files[0]` (v4). */
const fileOf = (v) => v?.file ?? v?.files?.[0] ?? null;

/**
 * Looks a version number up in pages of AMO version objects.
 * @returns {{ state: 'missing' } | { state: 'unsigned', status: string } | { state: 'signed', url: string, sha256: string|null }}
 */
export function findSignedFile(results, version) {
  const v = results.find((r) => r?.version === version);
  if (!v) return { state: 'missing' };
  const file = fileOf(v);
  // 'public' is a signed file (unlisted ones are signed as soon as they pass validation).
  if (!file?.url || file.status !== 'public') return { state: 'unsigned', status: file?.status ?? 'no file' };
  const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(file.hash ?? '')?.[1]?.toLowerCase() ?? null;
  return { state: 'signed', url: file.url, sha256 };
}

async function amoFetch(url, issuer, secret) {
  return fetch(url, { headers: { Authorization: `JWT ${amoJwt(issuer, secret)}` } });
}

async function main() {
  const { values } = parseArgs({ options: { version: { type: 'string' }, out: { type: 'string' }, id: { type: 'string' } } });
  const { AMO_ISSUER: issuer, AMO_SECRET: secret } = process.env;
  if (!values.version || !values.out) throw new Error('usage: --version x.y.z --out file.xpi');
  if (!issuer || !secret) throw new Error('AMO_ISSUER and AMO_SECRET must be set');
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const addonId = values.id ?? manifest.browser_specific_settings.gecko.id;

  const results = [];
  for (let url = versionsUrl(addonId); url; ) {
    const res = await amoFetch(url, issuer, secret);
    if (res.status === 404) {
      console.log(`Mozilla does not know ${addonId} yet: nothing signed.`);
      return NOT_FOUND;
    }
    if (!res.ok) throw new Error(`addons.mozilla.org answered HTTP ${res.status} for the version list`);
    const page = await res.json();
    results.push(...(page.results ?? []));
    url = page.next;
  }

  const found = findSignedFile(results, values.version);
  if (found.state === 'missing') {
    console.log(`Mozilla has no version ${values.version} of ${addonId}: it will be signed now.`);
    return NOT_FOUND;
  }
  if (found.state === 'unsigned') {
    console.log(`Mozilla has version ${values.version} but has not signed it (file status: ${found.status}). Re-run once it is approved.`);
    return NOT_SIGNED;
  }

  const res = await amoFetch(found.url, issuer, secret);
  if (!res.ok) throw new Error(`downloading the signed file failed with HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (found.sha256 && got !== found.sha256) throw new Error(`the downloaded file's sha256 ${got} is not Mozilla's ${found.sha256}`);
  const out = resolve(values.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  console.log(`Mozilla already signed ${values.version}: downloaded it (${bytes.length} bytes, sha256 ${got}).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`amo-signed-file: ${err.message}`);
      process.exitCode = 1;
    },
  );
}
