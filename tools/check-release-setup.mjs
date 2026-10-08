#!/usr/bin/env node
// check-release-setup: finds the three release credentials in the repository secrets and checks they work,
// without signing anything or using up a version number.
//
//   node tools/check-release-setup.mjs            full check (release-check.yml): report, ask Mozilla, test the token
//   node tools/check-release-setup.mjs --offline  only which credentials are present (release.yml, first step)
//   node tools/check-release-setup.mjs --export   full check, then hand the credentials to the later steps of
//                                                 release.yml as AMO_ISSUER, AMO_SECRET and UPDATES_TOKEN
//
// The credentials are a Mozilla JWT issuer, a Mozilla JWT secret and a GitHub token that can push to the
// updates repo. Each can be its own secret (AMO_JWT_ISSUER, AMO_JWT_SECRET, UPDATES_REPO_TOKEN), or one
// secret, MOZILLA_GITHUB, can hold all three (one per line, labels allowed). They are told apart by shape.
// It never prints a secret, and masks every part of one in the Actions log.
// Exit code 0 when everything a release needs is in place.
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UPDATES_REPO, UPDATES_BRANCH } from './update-manifest.mjs';

/** The secret names the workflows pass in, named ones first: they win over MOZILLA_GITHUB. */
export const SECRET_NAMES = ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET', 'UPDATES_REPO_TOKEN', 'MOZILLA_GITHUB'];

/** What a single value looks like. Never returns the value itself. */
export function kindOf(value) {
  if (/^user:\d+:\d+$/.test(value)) return 'mozilla-issuer';
  if (/^[0-9a-f]{64}$/i.test(value)) return 'mozilla-secret';
  if (/^github_pat_\w{20,}$/.test(value)) return 'github-fine-grained-token';
  if (/^gh[pousr]_\w{20,}$/.test(value)) return 'github-classic-token';
  return 'unknown';
}

const unquote = (s) => s.replace(/^["']|["']$/g, '');
const unlabel = (s) => s.replace(/^[A-Za-z_][\w-]*[=:]/, '');
/** A bare label such as `AMO_JWT_ISSUER:`, `issuer=` or `JWT`, or a lone `=` or `:`: not a value. */
const isLabel = (s) => /^(?:[A-Za-z_][\w-]*)?[=:]?$/.test(s);

/**
 * The values in one secret. A secret may hold one value or several, one per line, with or without a
 * label (`AMO_JWT_ISSUER: user:1:2`, `AMO_JWT_SECRET="…"`). Labels are dropped; anything else that is not
 * recognised is kept as 'unknown' so it is still masked and reported.
 */
export function piecesOf(raw) {
  const pieces = [];
  for (const token of String(raw ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const candidates = [token, unquote(token), unquote(unlabel(token)), unquote(unlabel(unquote(token)))];
    const value = candidates.find((c) => kindOf(c) !== 'unknown');
    if (value) pieces.push({ value, kind: kindOf(value) });
    else if (!isLabel(token)) pieces.push({ value: token, kind: 'unknown' });
  }
  return pieces;
}

/** Picks the first issuer, secret and GitHub token found across the secrets, in SECRET_NAMES order. */
export function resolveCredentials(env) {
  const found = { issuer: null, secret: null, token: null };
  const report = [];
  for (const name of SECRET_NAMES) {
    const pieces = piecesOf(env[name]);
    report.push({ name, set: Boolean(env[name]), kinds: pieces.map((p) => p.kind) });
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
  try {
    const res = await fetch('https://addons.mozilla.org/api/v5/accounts/profile/', {
      headers: { Authorization: `JWT ${amoJwt(issuer, secret)}` },
    });
    if (res.ok) return { ok: true, detail: 'accepted by addons.mozilla.org' };
    return { ok: false, detail: `refused by addons.mozilla.org (HTTP ${res.status}); generate new credentials` };
  } catch (err) {
    return { ok: false, detail: `addons.mozilla.org did not answer (${err.cause?.code || err.message})` };
  }
}

function checkGitHub(token) {
  const dir = mkdtempSync(join(tmpdir(), 'updates-check-'));
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const git = (args, cwd) => execFileSync('git', ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, ...args], { stdio: 'pipe', cwd });
  try {
    try {
      git(['clone', '--depth', '1', '--branch', UPDATES_BRANCH, `https://github.com/${UPDATES_REPO}.git`, 'u'], dir);
    } catch {
      return { ok: false, detail: `cannot read ${UPDATES_REPO} (branch ${UPDATES_BRANCH})` };
    }
    try {
      git(['push', '--dry-run', 'origin', `HEAD:${UPDATES_BRANCH}`], join(dir, 'u'));
    } catch {
      return { ok: false, detail: `can read ${UPDATES_REPO} but not push to it (needs Contents: Read and write, and must not have expired)` };
    }
    return { ok: true, detail: `can read and push to ${UPDATES_REPO}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const offline = argv.includes('--offline');
  const exporting = argv.includes('--export');
  const inActions = Boolean(process.env.GITHUB_ACTIONS);

  // GitHub masks a secret's whole value, not the parts of one that holds several. Mask each part.
  if (inActions) for (const name of SECRET_NAMES) for (const p of piecesOf(process.env[name])) console.log(`::add-mask::${p.value}`);

  const { found, report } = resolveCredentials(process.env);
  const lines = ['## Release setup', '', '| Secret | Set | Holds |', '|---|---|---|'];
  for (const r of report) lines.push(`| ${r.name} | ${r.set ? 'yes' : 'no'} | ${r.kinds.join(', ') || '-'} |`);
  lines.push('');

  let ok = true;
  const missing = [!found.issuer && 'the Mozilla JWT issuer', !found.secret && 'the Mozilla JWT secret', !found.token && 'a GitHub token for the updates repo'].filter(Boolean);
  if (missing.length) {
    ok = false;
    lines.push(`- Missing: ${missing.join(', ')}. See docs/RELEASING.md, one-time setup.`);
  }
  if (!offline) {
    if (found.issuer && found.secret) {
      const m = await checkMozilla(found.issuer.value, found.secret.value);
      ok &&= m.ok;
      lines.push(`- Mozilla credentials (from ${[...new Set([found.issuer.from, found.secret.from])].join(' and ')}): ${m.ok ? 'OK' : 'FAIL'}, ${m.detail}.`);
    }
    if (found.token) {
      const g = checkGitHub(found.token.value);
      ok &&= g.ok;
      lines.push(`- GitHub token (from ${found.token.from}): ${g.ok ? 'OK' : 'FAIL'}, ${g.detail}.`);
    }
  }
  lines.push('', ok ? 'Everything a release needs is in place.' : 'Not ready to release.');

  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (!ok && inActions) console.log(`::error title=Release setup::${missing.length ? `Missing ${missing.join(', ')}` : 'A credential was refused'}. See the step output and docs/RELEASING.md.`);

  if (ok && exporting) {
    if (!process.env.GITHUB_ENV) throw new Error('--export only works inside GitHub Actions');
    // Every value matched a strict pattern (no newlines), so plain NAME=value lines are safe here.
    appendFileSync(process.env.GITHUB_ENV, `AMO_ISSUER=${found.issuer.value}\nAMO_SECRET=${found.secret.value}\nUPDATES_TOKEN=${found.token.value}\n`);
  }
  process.exitCode = ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
