// The release pipeline: tools/update-manifest.mjs (updates.json), tools/release.mjs (version bump, changelog,
// commit and tag), and the guards around them (workflows, licence, manifest update_url).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './_load.mjs';
import { UPDATE_URL, addRelease, compareVersions as compareUpdateVersions, formatManifest, normalizeSha256, xpiLink } from '../../tools/update-manifest.mjs';
import { bumpVersion, changelogSection, compareVersions, formatDate, parseVersion, rewriteChangelog, setJsonVersion, unreleasedNotes } from '../../tools/release.mjs';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const ID = 'at-peace@cristianbagrin';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const release = (version, sha256 = HASH_A) => ({ id: ID, version, link: xpiLink(version), sha256 });

describe('update manifest (updates.json)', () => {
  test('a first release makes the Firefox update manifest', () => {
    const m = addRelease('', release('0.2.0', HASH_A));
    assert.deepEqual(m, {
      addons: {
        [ID]: {
          updates: [
            {
              version: '0.2.0',
              update_link: 'https://raw.githubusercontent.com/cristianbagrin/at-peace-updates/main/xpi/at-peace-0.2.0.xpi',
              update_hash: `sha256:${HASH_A}`,
            },
          ],
        },
      },
    });
    for (const empty of [undefined, null, '  \n']) assert.deepEqual(addRelease(empty, release('0.2.0', HASH_A)), m);
  });

  test('older entries stay and the newest is last, whatever order they arrive in', () => {
    let m = addRelease(null, release('0.10.0', HASH_C));
    m = addRelease(m, release('0.2.0', HASH_A));
    m = addRelease(JSON.stringify(m), release('0.9.1', HASH_B));
    assert.deepEqual(m.addons[ID].updates.map((u) => u.version), ['0.2.0', '0.9.1', '0.10.0']);
    assert.equal(m.addons[ID].updates[0].update_hash, `sha256:${HASH_A}`);
  });

  test('adding a version twice never duplicates it (the later one wins)', () => {
    const once = addRelease(null, release('0.2.0', HASH_A));
    assert.deepEqual(addRelease(once, release('0.2.0', HASH_A)), once);
    const again = addRelease(once, release('0.2.0', HASH_B));
    assert.equal(again.addons[ID].updates.length, 1);
    assert.equal(again.addons[ID].updates[0].update_hash, `sha256:${HASH_B}`);
  });

  test('other add-ons and extra keys survive; the input is not changed', () => {
    const input = { addons: { 'other@x': { updates: [{ version: '1.0.0', update_link: 'https://x/y.xpi' }], note: 'keep' } }, extra: 1 };
    const frozen = structuredClone(input);
    const out = addRelease(input, release('0.2.0'));
    assert.deepEqual(input, frozen);
    assert.equal(out.extra, 1);
    assert.equal(out.addons['other@x'].note, 'keep');
    assert.equal(out.addons['other@x'].updates.length, 1);
    assert.equal(out.addons[ID].updates.length, 1);
  });

  test('sha256 is normalised; bad input is refused with a clear message', () => {
    assert.equal(normalizeSha256(`SHA256:${'AB'.repeat(32)}`), 'ab'.repeat(32));
    assert.equal(addRelease(null, { ...release('0.2.0'), sha256: ` ${'CD'.repeat(32)}\n` }).addons[ID].updates[0].update_hash, `sha256:${'cd'.repeat(32)}`);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), sha256: 'abc' }), /sha256 must be 64 hex digits/);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), version: '0.2' }), /version must look like/);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), version: '0.2.0-beta' }), /version must look like/);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), link: 'http://example.com/a.xpi' }), /must be https/);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), link: 'not a url' }), /not a URL/);
    assert.throws(() => addRelease(null, { ...release('0.2.0'), id: '' }), /id is required/);
    assert.throws(() => addRelease('{nope', release('0.2.0')), /not valid JSON/);
    assert.throws(() => addRelease('[]', release('0.2.0')), /must be a JSON object/);
    assert.throws(() => addRelease({ addons: { [ID]: { updates: {} } } }, release('0.2.0')), /must be an array/);
  });

  test('formatManifest is two-space JSON with a final newline', () => {
    const text = formatManifest(addRelease(null, release('0.2.0')));
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.startsWith('{\n  "addons": {\n    "at-peace@cristianbagrin": {'));
    assert.deepEqual(JSON.parse(text), addRelease(null, release('0.2.0')));
  });

  test('version order is numeric', () => {
    assert.ok(compareUpdateVersions('0.10.0', '0.9.0') > 0);
    assert.ok(compareUpdateVersions('1.0.0', '0.99.99') > 0);
    assert.equal(compareUpdateVersions('1.2.3', '1.2.3'), 0);
  });

  test("the manifest's update_url is the file this tool maintains", () => {
    const gecko = JSON.parse(read('manifest.json')).browser_specific_settings.gecko;
    assert.equal(gecko.update_url, UPDATE_URL);
    assert.equal(UPDATE_URL, 'https://raw.githubusercontent.com/cristianbagrin/at-peace-updates/main/updates.json');
  });

  test('the CLI hashes the .xpi and can run twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-peace-um-'));
    try {
      const xpi = join(dir, 'at-peace-9.9.9.xpi');
      const file = join(dir, 'updates.json');
      writeFileSync(xpi, 'signed bytes');
      const args = ['tools/update-manifest.mjs', '--file', file, '--xpi', xpi, '--version', '9.9.9'];
      for (let i = 0; i < 2; i++) {
        const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
      }
      const m = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(m.addons[ID].updates.length, 1);
      assert.equal(m.addons[ID].updates[0].version, '9.9.9');
      assert.equal(m.addons[ID].updates[0].update_link, xpiLink('9.9.9'));
      // sha256("signed bytes")
      assert.equal(m.addons[ID].updates[0].update_hash, 'sha256:' + execFileSync('node', ['-e', "process.stdout.write(require('node:crypto').createHash('sha256').update('signed bytes').digest('hex'))"], { encoding: 'utf8' }));
      const bad = spawnSync(process.execPath, ['tools/update-manifest.mjs', '--file', file, '--sha256', 'zz'], { cwd: ROOT, encoding: 'utf8' });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /sha256 must be 64 hex digits/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release: version', () => {
  test('patch, minor, major', () => {
    assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
    assert.equal(bumpVersion('0.1.9', 'patch'), '0.1.10');
    assert.equal(bumpVersion('0.1.4', 'minor'), '0.2.0');
    assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  });

  test('an explicit version must be higher', () => {
    assert.equal(bumpVersion('0.1.0', '0.3.0'), '0.3.0');
    assert.equal(bumpVersion('0.1.0', 'v1.0.0'), '1.0.0');
    assert.equal(bumpVersion('0.9.0', '0.10.0'), '0.10.0');
    assert.throws(() => bumpVersion('0.2.0', '0.2.0'), /not higher/);
    assert.throws(() => bumpVersion('0.2.0', '0.1.9'), /not higher/);
  });

  test('anything else is refused', () => {
    for (const spec of ['', undefined, 'latest', '1.2', '1.2.3.4', '1.2.3-beta', 'Patch']) assert.throws(() => bumpVersion('0.1.0', spec), /not patch, minor, major/);
    assert.throws(() => bumpVersion('0.1', 'patch'), /not a version/);
  });

  test('parse and compare', () => {
    assert.deepEqual(parseVersion('10.20.30'), [10, 20, 30]);
    assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });

  test('dates are YYYY-MM-DD', () => {
    assert.equal(formatDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(formatDate(new Date(2026, 9, 31)), '2026-10-31');
  });

  test('setJsonVersion changes only the version lines of the real files', () => {
    for (const [file, lock, lines] of [['manifest.json', false, 1], ['package.json', false, 1], ['package-lock.json', true, 2]]) {
      const before = read(file);
      const after = setJsonVersion(before, '7.8.9', { lock });
      const a = before.split('\n');
      const b = after.split('\n');
      assert.equal(a.length, b.length, file);
      const changed = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y);
      assert.equal(changed.length, lines, `${file}: ${JSON.stringify(changed)}`);
      for (const [, y] of changed) assert.match(y, /^\s*"version": "7\.8\.9",?$/);
      const parsed = JSON.parse(after);
      assert.equal(parsed.version, '7.8.9');
      if (lock) assert.equal(parsed.packages[''].version, '7.8.9');
    }
  });

  test('setJsonVersion refuses what it cannot set', () => {
    assert.throws(() => setJsonVersion('{"name": "x"}', '1.0.0'), /could not set/);
    assert.throws(() => setJsonVersion('{"version": "0.1.0"}', '1.0.0', { lock: true }), /root package version/);
    assert.throws(() => setJsonVersion('{"version": "0.1.0"}', 'one'), /not a version/);
  });

  test('the three version fields agree today', () => {
    const v = JSON.parse(read('manifest.json')).version;
    assert.equal(JSON.parse(read('package.json')).version, v);
    assert.equal(JSON.parse(read('package-lock.json')).version, v);
    assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, v);
  });
});

describe('release: CHANGELOG', () => {
  const sample = `# Changelog

Intro text.

## Unreleased

### Added

- A thing.

### Fixed

- Another thing.

## 0.1.0 - first release

The first version.

### Declutter

- Stuff.
`;

  test('Unreleased becomes the new version, with a fresh empty Unreleased above it', () => {
    const out = rewriteChangelog(sample, '0.2.0', '2026-10-07');
    assert.equal(
      out,
      `# Changelog

Intro text.

## Unreleased

## 0.2.0 — 2026-10-07

### Added

- A thing.

### Fixed

- Another thing.

## 0.1.0 - first release

The first version.

### Declutter

- Stuff.
`,
    );
    assert.equal(unreleasedNotes(out), '');
    assert.equal(changelogSection(out, '0.2.0'), '### Added\n\n- A thing.\n\n### Fixed\n\n- Another thing.');
    // releasing straight away again is refused: nothing new under Unreleased
    assert.throws(() => rewriteChangelog(out, '0.2.1', '2026-10-08'), /nothing under "## Unreleased"/);
  });

  test('Unreleased as the last section, and the bracketed spelling', () => {
    const out = rewriteChangelog('# Changelog\n\n## [Unreleased]\n\n- One line.\n', '1.0.0', '2027-01-01');
    assert.equal(out, '# Changelog\n\n## Unreleased\n\n## 1.0.0 — 2027-01-01\n\n- One line.\n');
  });

  test('a missing or empty Unreleased is refused', () => {
    assert.throws(() => rewriteChangelog('# Changelog\n\n## 0.1.0 - first release\n\n- x\n', '0.2.0', '2026-10-07'), /no "## Unreleased" section/);
    assert.throws(() => rewriteChangelog('# Changelog\n\n## Unreleased\n\n## 0.1.0 - first release\n\n- x\n', '0.2.0', '2026-10-07'), /nothing under/);
    assert.throws(() => rewriteChangelog('# Changelog\n\n## Unreleased\n', '0.2.0', '2026-10-07'), /nothing under/);
    assert.equal(unreleasedNotes('# Changelog\n\n## 0.1.0 - x\n'), null);
  });

  test('changelogSection finds a version by its heading', () => {
    assert.equal(changelogSection(sample, '0.1.0'), 'The first version.\n\n### Declutter\n\n- Stuff.');
    assert.equal(changelogSection(sample, '0.1'), null);
    assert.equal(changelogSection(sample, '0.2.0'), null);
    assert.equal(changelogSection('## [1.0.0] — 2027-01-01\n\nHi.\n\n## 0.9.0\n\nOld.\n', '1.0.0'), 'Hi.');
    // 0.1.0 must not match 0.1.01 or 10.1.0
    assert.equal(changelogSection('## 10.1.0 — x\n\nNo.\n', '0.1.0'), null);
  });

  test('the shipped CHANGELOG keeps an Unreleased section for the next release', () => {
    assert.notEqual(unreleasedNotes(read('CHANGELOG.md')), null, 'CHANGELOG.md needs a "## Unreleased" heading');
  });
});

describe('release: the script, end to end in a scratch repository', () => {
  /** A throwaway repo that has tools/release.mjs and stub npm scripts, so the whole flow runs in a second or two. */
  function scratch({ changelog = '# Changelog\n\n## Unreleased\n\n- Something changed.\n\n## 0.1.0 - first release\n\nFirst.\n', scripts } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'at-peace-rel-'));
    mkdirSync(join(dir, 'tools'));
    cpSync(join(ROOT, 'tools', 'release.mjs'), join(dir, 'tools', 'release.mjs'));
    writeFileSync(join(dir, 'manifest.json'), '{\n  "manifest_version": 3,\n  "name": "X",\n  "version": "0.1.0",\n  "permissions": ["storage", "alarms"]\n}\n');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.1.0', private: true, type: 'module', scripts: scripts ?? { lint: 'node -e 0', test: 'node -e 0', 'verify:package': 'node -e 0' } }, null, 2) + '\n',
    );
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'x', version: '0.1.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '0.1.0' } } }, null, 2) + '\n');
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('add', '-A');
    git('commit', '-q', '-m', 'start');
    const run = (...args) => spawnSync(process.execPath, ['tools/release.mjs', ...args], { cwd: dir, encoding: 'utf8' });
    return { dir, git, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test('a release bumps all three versions, rewrites the changelog, commits and tags (and does not push)', () => {
    const s = scratch();
    try {
      const r = s.run('minor');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      for (const f of ['manifest.json', 'package.json', 'package-lock.json']) assert.equal(JSON.parse(readFileSync(join(s.dir, f), 'utf8')).version, '0.2.0', f);
      assert.equal(JSON.parse(readFileSync(join(s.dir, 'package-lock.json'), 'utf8')).packages[''].version, '0.2.0');
      assert.match(readFileSync(join(s.dir, 'manifest.json'), 'utf8'), /"permissions": \["storage", "alarms"\]/, 'manifest formatting is kept');
      const changelog = readFileSync(join(s.dir, 'CHANGELOG.md'), 'utf8');
      assert.match(changelog, /^# Changelog\n\n## Unreleased\n\n## 0\.2\.0 — \d{4}-\d{2}-\d{2}\n\n- Something changed\.\n\n## 0\.1\.0 - first release/);
      assert.equal(s.git('log', '-1', '--format=%s'), 'Release 0.2.0');
      assert.equal(s.git('status', '--porcelain'), '');
      assert.equal(s.git('tag', '--list'), 'v0.2.0');
      assert.equal(s.git('cat-file', '-t', 'v0.2.0'), 'tag');
      assert.match(r.stdout, /git push && git push origin v0\.2\.0/);
      assert.match(s.run('--notes', '0.2.0').stdout, /^- Something changed\.$/m);
    } finally {
      s.cleanup();
    }
  });

  test('--dry-run changes nothing and says what a real run would do', () => {
    const s = scratch();
    try {
      const r = s.run('patch', '--dry-run');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /release 0\.1\.0 -> 0\.1\.1 \(dry run/);
      assert.match(r.stdout, /git tag -a v0\.1\.1/);
      assert.match(r.stdout, /Nothing would stop a real run/);
      assert.equal(s.git('status', '--porcelain'), '');
      assert.equal(s.git('tag', '--list'), '');
      assert.equal(s.git('rev-list', '--count', 'HEAD'), '1');
    } finally {
      s.cleanup();
    }
  });

  test('it refuses on a dirty tree', () => {
    const s = scratch();
    try {
      writeFileSync(join(s.dir, 'notes.txt'), 'loose');
      const r = s.run('patch');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /working tree is not clean/);
      assert.equal(s.git('tag', '--list'), '');
      assert.equal(JSON.parse(readFileSync(join(s.dir, 'manifest.json'), 'utf8')).version, '0.1.0');
      const dry = s.run('patch', '--dry-run');
      assert.equal(dry.status, 1);
      assert.match(dry.stdout, /A real run would refuse/);
    } finally {
      s.cleanup();
    }
  });

  test('it refuses an empty Unreleased, an existing tag, a lower version and disagreeing versions', () => {
    const empty = scratch({ changelog: '# Changelog\n\n## Unreleased\n\n## 0.1.0 - first release\n\nFirst.\n' });
    try {
      const r = empty.run('patch');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /nothing under "## Unreleased"/);
      empty.git('tag', 'v0.1.1');
      assert.match(empty.run('patch').stderr, /tag v0\.1\.1 already exists/);
      assert.match(empty.run('0.0.9').stderr, /not higher/);
      writeFileSync(join(empty.dir, 'package.json'), readFileSync(join(empty.dir, 'package.json'), 'utf8').replace('"0.1.0"', '"0.1.5"'));
      assert.match(empty.run('minor').stderr, /versions disagree/);
    } finally {
      empty.cleanup();
    }
  });

  test('a failing check stops it before anything is changed', () => {
    const s = scratch({ scripts: { lint: 'node -e 0', test: 'node -e "process.exit(1)"', 'verify:package': 'node -e 0' } });
    try {
      const r = s.run('patch');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /npm run test failed; nothing was changed/);
      assert.equal(s.git('status', '--porcelain'), '');
      assert.equal(s.git('tag', '--list'), '');
    } finally {
      s.cleanup();
    }
  });

  test('if the bumped package does not verify, the files are put back', () => {
    // verify:package passes the first time (before the bump) and fails the second: it fails once manifest.json says 0.1.1.
    const s = scratch({ scripts: { lint: 'node -e 0', test: 'node -e 0', 'verify:package': `node -e "process.exit(require('./manifest.json').version === '0.1.0' ? 0 : 1)"` } });
    try {
      const r = s.run('patch');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /did not verify; the four files were put back/);
      assert.equal(s.git('status', '--porcelain'), '');
      assert.equal(s.git('tag', '--list'), '');
    } finally {
      s.cleanup();
    }
  });
});

describe('release: guards in the repository', () => {
  const workflows = readdirSync(join(ROOT, '.github', 'workflows')).filter((f) => f.endsWith('.yml'));

  test('both workflows exist', () => {
    assert.deepEqual(workflows.sort(), ['ci.yml', 'release.yml']);
  });

  test('every action is pinned to a full commit SHA', () => {
    for (const f of workflows) {
      const text = read(`.github/workflows/${f}`);
      const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
      assert.ok(uses.length > 0, f);
      for (const u of uses) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${u}`);
    }
  });

  test('ci.yml: Node 22, install, lint, test, verify:package; no secrets', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /^on:\n {2}push:\n {4}branches: \['\*\*'\]\n {2}pull_request:/m);
    assert.match(ci, /node-version: 22/);
    for (const cmd of ['npm ci', 'npm run lint', 'npm test', 'npm run verify:package']) assert.ok(ci.includes(`run: ${cmd}`), cmd);
    assert.ok(!ci.includes('secrets.'));
  });

  test('release.yml: on version tags; checks, signs unlisted, publishes, releases', () => {
    const rel = read('.github/workflows/release.yml');
    assert.match(rel, /^on:\n {2}push:\n {4}tags: \['v\*'\]/m);
    assert.match(rel, /node-version: 22/);
    for (const cmd of ['npm ci', 'npm run lint', 'npm test', 'npm run verify:package']) assert.ok(rel.includes(`run: ${cmd}`), cmd);
    assert.match(rel, /web-ext sign --channel=unlisted/);
    for (const secret of ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET', 'UPDATES_REPO_TOKEN', 'GITHUB_TOKEN']) assert.ok(rel.includes(`secrets.${secret}`), secret);
    assert.match(rel, /tools\/update-manifest\.mjs --file/);
    assert.match(rel, /gh release create/);
    assert.match(rel, /unzip -Z1 .*grep -vxE 'manifest\\\.json\|icons\|src\|META-INF'/, 'the signed package is checked for stray top-level entries');
    assert.match(rel, /UPDATES_REPO: cristianbagrin\/at-peace-updates/);
    assert.match(rel, /cancel-in-progress: false/);
    // the order matters: access to the updates repo is checked before the version is spent at Mozilla
    const order = ['Check access to the updates repo', 'Sign with Mozilla', 'Keep the signed file', 'Publish to the updates repo', 'GitHub Release'].map((n) => rel.indexOf(`name: ${n}`));
    assert.ok(order.every((i) => i > 0), `missing step: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    // nothing but the source tree may sit in the folder web-ext packs
    assert.ok(!/path:\s*updates/.test(rel), 'do not check the updates repo out inside the workspace');
  });

  test('licence: all rights reserved, UNLICENSED, and not shipped', async () => {
    assert.ok(existsSync(join(ROOT, 'LICENSE')));
    assert.match(read('LICENSE'), /^Copyright \(c\) 2026 Cristian Bagrin\. All rights reserved\./);
    assert.match(read('LICENSE'), /may install and use At Peace/);
    assert.equal(JSON.parse(read('package.json')).license, 'UNLICENSED');
    assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, 'UNLICENSED');
    const config = (await import('../../web-ext-config.mjs')).default;
    assert.ok(config.ignoreFiles.includes('LICENSE'));
    // `web-ext sign` builds into a temp folder: without this it would pack an (empty) web-ext-artifacts folder
    assert.ok(config.ignoreFiles.includes('web-ext-artifacts'));
  });

  test('npm run release is wired up', () => {
    assert.equal(JSON.parse(read('package.json')).scripts.release, 'node tools/release.mjs');
    assert.ok(existsSync(join(ROOT, 'docs', 'RELEASING.md')));
  });
});
