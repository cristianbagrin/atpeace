#!/usr/bin/env node
// release: cuts a version. Run it from a clean checkout once the change and its CHANGELOG entry are committed.
//
//   npm run release -- <patch|minor|major|x.y.z> [--dry-run]
//   node tools/release.mjs --notes <x.y.z>        prints that version's CHANGELOG section (used by the workflow)
//
// It refuses on a dirty tree, then runs lint, the unit tests and verify:package, bumps the version in
// manifest.json, package.json and package-lock.json, turns "## Unreleased" in CHANGELOG.md into
// "## x.y.z — YYYY-MM-DD" (leaving a new empty "## Unreleased"), checks the package again, commits
// "Release x.y.z" and tags vx.y.z. It does not push: the operator runs `git push && git push origin vx.y.z`,
// and the tag starts .github/workflows/release.yml. --dry-run changes nothing and runs no checks; it prints
// what a real run would do and what would make it refuse.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['manifest.json', 'package.json', 'package-lock.json', 'CHANGELOG.md'];

// ---------------------------------------------------------------------------------------------
// Pure parts (unit-tested in tests/unit/release.test.mjs)
// ---------------------------------------------------------------------------------------------

/** "1.2.3" to [1, 2, 3]; throws on anything else. */
export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!m) throw new Error(`"${version}" is not a version like 1.2.3`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative when a < b. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/**
 * The version a release command asks for. `spec` is patch, minor, major or an explicit x.y.z
 * (a leading "v" is accepted); an explicit one must be higher than `current`, because Mozilla
 * refuses a version it has already seen and updates only ever go up.
 */
export function bumpVersion(current, spec) {
  const [major, minor, patch] = parseVersion(current);
  const wanted = String(spec ?? '').trim();
  if (wanted === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (wanted === 'minor') return `${major}.${minor + 1}.0`;
  if (wanted === 'major') return `${major + 1}.0.0`;
  const explicit = wanted.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(explicit)) throw new Error(`"${spec}" is not patch, minor, major or a version like 1.2.3`);
  if (compareVersions(explicit, current) <= 0) throw new Error(`${explicit} is not higher than the current version ${current}`);
  return explicit;
}

/** YYYY-MM-DD in local time. */
export function formatDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const VERSION_LINE = /^(\s*"version":\s*")[^"]*(")/m;
const LOCK_ROOT_VERSION = /("packages":\s*\{\s*"":\s*\{[^{}]*?"version":\s*")[^"]*(")/;

/**
 * Sets the top-level "version" of manifest.json or package.json (or of package-lock.json, which has a
 * second one for the root package) in the file's own text, so nothing else in it is reformatted.
 * @param {string} text
 * @param {string} version
 * @param {{ lock?: boolean }} [options]
 */
export function setJsonVersion(text, version, { lock = false } = {}) {
  parseVersion(version);
  let out = text.replace(VERSION_LINE, `$1${version}$2`);
  if (lock) {
    if (!LOCK_ROOT_VERSION.test(out)) throw new Error('package-lock.json: could not find the root package version');
    out = out.replace(LOCK_ROOT_VERSION, `$1${version}$2`);
  }
  const parsed = JSON.parse(out);
  const rootVersion = lock ? parsed.packages?.['']?.version : version;
  if (parsed.version !== version || rootVersion !== version) throw new Error(`could not set the version to ${version}`);
  return out;
}

/** "## Unreleased" (also "## [Unreleased]"), alone on its line. */
const UNRELEASED_HEADING = /^##[ \t]+\[?Unreleased\]?[ \t]*$/im;
const ANY_H2 = /^## /m;

/** Splits a changelog around its Unreleased section; null when there is none. */
function splitUnreleased(text) {
  const heading = UNRELEASED_HEADING.exec(text);
  if (!heading) return null;
  const bodyStart = heading.index + heading[0].length;
  const rest = text.slice(bodyStart);
  const next = ANY_H2.exec(rest);
  const bodyEnd = next ? bodyStart + next.index : text.length;
  return { before: text.slice(0, heading.index), body: text.slice(bodyStart, bodyEnd), after: text.slice(bodyEnd) };
}

/** The text under "## Unreleased" (trimmed), or null when the changelog has no such section. */
export function unreleasedNotes(text) {
  const parts = splitUnreleased(text);
  return parts ? parts.body.trim() : null;
}

/**
 * Turns "## Unreleased" into "## <version> — <date>" and puts a new, empty "## Unreleased" above it.
 * Throws when there is no Unreleased section or nothing under it: a release without a note is a mistake.
 */
export function rewriteChangelog(text, version, date) {
  const parts = splitUnreleased(text);
  if (!parts) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  const notes = parts.body.trim();
  if (notes === '') throw new Error('CHANGELOG.md has nothing under "## Unreleased": add a line about this release first');
  const after = parts.after.replace(/^\s+/, '');
  return `${parts.before}## Unreleased\n\n## ${version} — ${date}\n\n${notes}\n${after === '' ? '' : `\n${after}`}`;
}

/** The notes under the "## <version> …" heading (trimmed), or null when that version has no section. */
export function changelogSection(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##[ \\t]+\\[?${escaped}\\]?(?=[ \\t]|$)[^\\n]*$`, 'm').exec(text);
  if (!heading) return null;
  const bodyStart = heading.index + heading[0].length;
  const rest = text.slice(bodyStart);
  const next = /\n## /.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

// ---------------------------------------------------------------------------------------------
// The release itself
// ---------------------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

/** Runs an npm script with its output shown; false when it fails. */
function runNpm(script) {
  console.log(`\n$ npm run ${script}`);
  const result = spawnSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit' });
  return result.status === 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, notes: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });

  if (values.notes !== undefined) {
    const section = changelogSection(await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'), values.notes);
    if (section === null) {
      console.error(`CHANGELOG.md has no section for ${values.notes}`);
      process.exit(1);
    }
    console.log(section);
    return;
  }

  const spec = positionals[0];
  if (!spec || positionals.length > 1) {
    console.error('Usage: npm run release -- <patch|minor|major|x.y.z> [--dry-run]');
    process.exit(2);
  }
  const dryRun = values['dry-run'];

  // --- read everything and find what would stop us ---
  const problems = [];
  const original = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await readFile(join(ROOT, f), 'utf8')])));
  const versions = {
    'manifest.json': JSON.parse(original['manifest.json']).version,
    'package.json': JSON.parse(original['package.json']).version,
    'package-lock.json': JSON.parse(original['package-lock.json']).version,
  };
  const current = versions['manifest.json'];
  if (new Set(Object.values(versions)).size !== 1) problems.push(`the versions disagree: ${Object.entries(versions).map(([f, v]) => `${f} ${v}`).join(', ')}`);

  let next = null;
  try {
    next = bumpVersion(current, spec);
  } catch (err) {
    problems.push(err.message);
  }

  const status = git('status', '--porcelain');
  if (status !== '') problems.push(`the working tree is not clean (commit or stash first):\n${status.split('\n').map((l) => `    ${l}`).join('\n')}`);
  if (!gitOk('symbolic-ref', '-q', 'HEAD')) problems.push('HEAD is detached: check out a branch first');
  if (next && gitOk('rev-parse', '-q', '--verify', `refs/tags/v${next}`)) problems.push(`tag v${next} already exists`);

  const date = formatDate(new Date());
  let changelog = null;
  if (next) {
    try {
      changelog = rewriteChangelog(original['CHANGELOG.md'], next, date);
    } catch (err) {
      problems.push(err.message);
    }
  }

  if (dryRun) {
    console.log(`release ${current} -> ${next ?? '?'} (dry run: nothing is changed, no checks are run)\n`);
    if (next) {
      console.log('A real run would:');
      console.log('  1. refuse if the working tree is dirty, HEAD is detached or the tag exists');
      console.log('  2. npm run lint, npm test, npm run verify:package');
      console.log(`  3. set the version to ${next} in manifest.json, package.json, package-lock.json`);
      console.log(`  4. CHANGELOG.md: "## Unreleased" becomes "## ${next} — ${date}", with a new empty "## Unreleased" above it`);
      console.log('  5. npm run verify:package again on the bumped files');
      console.log(`  6. git commit -m "Release ${next}" (${FILES.join(', ')}), git tag -a v${next}`);
      console.log(`  7. print: git push && git push origin v${next}   (it does not push)`);
      if (changelog) console.log(`\nRelease notes (from CHANGELOG.md):\n\n${unreleasedNotes(original['CHANGELOG.md'])}`);
    }
    if (problems.length > 0) {
      console.log('\nA real run would refuse:');
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
    } else console.log('\nNothing would stop a real run.');
    return;
  }

  if (problems.length > 0) {
    console.error('Not releasing:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // --- checks before anything is touched ---
  for (const script of ['lint', 'test', 'verify:package']) {
    if (!runNpm(script)) {
      console.error(`\nnpm run ${script} failed; nothing was changed.`);
      process.exit(1);
    }
  }

  // --- bump ---
  const updated = {
    'manifest.json': setJsonVersion(original['manifest.json'], next),
    'package.json': setJsonVersion(original['package.json'], next),
    'package-lock.json': setJsonVersion(original['package-lock.json'], next, { lock: true }),
    'CHANGELOG.md': changelog,
  };
  for (const f of FILES) await writeFile(join(ROOT, f), updated[f]);
  if (!runNpm('verify:package')) {
    for (const f of FILES) await writeFile(join(ROOT, f), original[f]);
    console.error(`\nThe bumped package did not verify; the four files were put back as they were.`);
    process.exit(1);
  }

  // --- commit and tag ---
  git('add', '--', ...FILES);
  git('commit', '-m', `Release ${next}`);
  git('tag', '-a', `v${next}`, '-m', `Release ${next}`);
  console.log(`\nReleased ${next} locally: commit "Release ${next}" and tag v${next}. Publish it with:\n\n  git push && git push origin v${next}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`release: ${err.stderr?.toString().trim() || err.message}`);
    process.exit(1);
  });
}
