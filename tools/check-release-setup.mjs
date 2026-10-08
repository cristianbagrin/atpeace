#!/usr/bin/env node
// check-release-setup: tells whether the repository secrets the release workflow needs are there and
// work, without signing anything or using up a version number. Run by .github/workflows/release-check.yml.
//
// It never prints a secret. For each secret it says what kind of value it looks like (a Mozilla JWT issuer,
// a Mozilla JWT secret, a GitHub token), then:
//   - asks addons.mozilla.org who the Mozilla credentials belong to (a signed, read-only API call);
//   - checks the GitHub token can read and push to the updates repo (`git push --dry-run`).
// Exit code 0 when everything a release needs is in place.
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UPDATES_REPO, UPDATES_BRANCH } from './update-manifest.mjs';

/** The secret names the workflow passes in, in the order they are reported. */
export const SECRET_NAMES = ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET', 'UPDATES_REPO_TOKEN', 'MOZILLA_GITHUB'];

/** What a single value looks like. Never returns the value itself. */
export function kindOf(value) {
  if (/^user:\d+:\d+$/.test(value)) return 'mozilla-issuer';
  if (/^[0-9a-f]{64}$/i.test(value)) return 'mozilla-secret';
  if (/^github_pat_\w{20,}$/.test(value)) return 'github-fine-grained-token';
  if (/^gh[pousr]_\w{20,}$/.test(value)) return 'github-classic-token';
  return 'unknown';
}

/** A secret may hold one value or several (one per line, or `NAME=value` lines). */
export function piecesOf(raw) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.replace(/^[A-Za-z_][\w-]*=/, '').replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map((value) => ({ value, kind: kindOf(value) }));
}

/** Picks the first issuer, secret and GitHub token found across all the secrets, named ones first. */
export function resolveCredentials(env) {
  const found = { issuer: null, secret: null, token: null };
  const report = [];
  for (const name of SECRET_NAMES) {
    const pieces = piecesOf(env[name]);
    report.push({ name, set: pieces.length > 0, kinds: pieces.map((p) => p.kind) });
    for (const p of pieces) {
      if (p.kind === 'mozilla-issuer' && !found.issuer) found.issuer = { value: p.value, from: name };
      if (p.kind === 'mozilla-secret' && !found.secret) found.secret = { value: p.value, from: name };
      if (p.kind.startsWith('github-') && !found.token) found.token = { value: p.value, from: name };
    }
  }
  return { found, report };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** The short-lived JWT addons.mozilla.org expects (HS256, at most 5 minutes). */
export function amoJwt(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function checkMozilla(issuer, secret) {
  const res = await fetch('https://addons.mozilla.org/api/v5/accounts/profile/', {
    headers: { Authorization: `JWT ${amoJwt(issuer, secret)}` },
  });
  if (res.ok) {
    const profile = await res.json();
    return { ok: true, detail: `accepted (Mozilla account: ${profile.name || profile.username || 'unnamed'})` };
  }
  return { ok: false, detail: `refused with HTTP ${res.status}` };
}

function checkGitHub(token) {
  const dir = mkdtempSync(join(tmpdir(), 'updates-check-'));
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const git = (...args) => execFileSync('git', ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, ...args], { stdio: 'pipe', cwd: dir });
  try {
    try {
      git('clone', '--depth', '1', '--branch', UPDATES_BRANCH, `https://github.com/${UPDATES_REPO}.git`, 'u');
    } catch {
      return { ok: false, detail: `cannot read ${UPDATES_REPO} (branch ${UPDATES_BRANCH})` };
    }
    try {
      execFileSync('git', ['-C', join(dir, 'u'), '-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '--dry-run', 'origin', `HEAD:${UPDATES_BRANCH}`], { stdio: 'pipe' });
    } catch {
      return { ok: false, detail: `can read ${UPDATES_REPO} but not push to it (needs Contents: Read and write)` };
    }
    return { ok: true, detail: `can read and push to ${UPDATES_REPO}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  // Parts of a secret that holds several values are not masked by GitHub on their own; mask each one.
  if (process.env.GITHUB_ACTIONS) for (const name of SECRET_NAMES) for (const p of piecesOf(process.env[name])) console.log(`::add-mask::${p.value}`);
  const { found, report } = resolveCredentials(process.env);
  const lines = ['## Release setup', '', '| Secret | Set | Looks like |', '|---|---|---|'];
  for (const r of report) lines.push(`| \`${r.name}\` | ${r.set ? 'yes' : 'no'} | ${r.kinds.join(', ') || '-'} |`);
  lines.push('');

  let ok = true;
  if (found.issuer && found.secret) {
    const m = await checkMozilla(found.issuer.value, found.secret.value);
    ok &&= m.ok;
    lines.push(`- Mozilla credentials (issuer from \`${found.issuer.from}\`, secret from \`${found.secret.from}\`): ${m.ok ? 'OK' : 'FAIL'}, ${m.detail}.`);
  } else {
    ok = false;
    lines.push(`- Mozilla credentials: MISSING ${[!found.issuer && 'JWT issuer', !found.secret && 'JWT secret'].filter(Boolean).join(' and ')}.`);
  }
  if (found.token) {
    const g = checkGitHub(found.token.value);
    ok &&= g.ok;
    lines.push(`- GitHub token (from \`${found.token.from}\`): ${g.ok ? 'OK' : 'FAIL'}, ${g.detail}.`);
  } else {
    ok = false;
    lines.push('- GitHub token for the updates repo: MISSING.');
  }
  lines.push('', ok ? 'Everything a release needs is in place.' : 'Not ready to release yet. See docs/RELEASING.md, one-time setup.');

  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
  process.exitCode = ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
