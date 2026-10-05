// The options and popup pages load the same shared stack as the content script, in the same order,
// followed by the page helpers. A forgotten or misordered <script> would only show up as a broken
// page, so the order is pinned here (tests/unit/manifest.test.mjs covers CSP and file existence).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ROOT, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Script `src` values of a page, resolved to repo-relative paths, in document order. */
function scriptsOf(page) {
  const dir = posix.dirname(page);
  return [...read(page).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => posix.normalize(posix.join(dir, m[1])));
}

function stylesheetsOf(page) {
  const dir = posix.dirname(page);
  return [...read(page).matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => posix.normalize(posix.join(dir, m[1])));
}

const SHARED = [...CORE_SCRIPTS, ...SCHEMA_SCRIPTS];
const HELPERS = ['src/shared/lock.js', 'src/pages/common/logic.js', 'src/pages/common/components.js', 'src/pages/common/lock-ui.js'];

for (const [name, page] of [
  ['options', 'src/pages/options/options.html'],
  ['popup', 'src/pages/popup/popup.html'],
]) {
  describe(`${name} page`, () => {
    test('loads the shared stack in manifest order, then the page helpers, then the page module last', () => {
      const scripts = scriptsOf(page).filter((s) => !s.endsWith('theme-boot.js'));
      assert.deepEqual(scripts.slice(0, SHARED.length), SHARED);
      assert.deepEqual(scripts.slice(SHARED.length, SHARED.length + HELPERS.length), HELPERS);
      assert.match(scripts.at(-1), new RegExp(`src/pages/${name}/${name}\\.js$`));
      assert.match(read(page), new RegExp(`<script type="module" src="${name}\\.js"></script>`));
    });

    test('sets the theme before first paint and links the shared design tokens', () => {
      const html = read(page);
      assert.ok(html.indexOf('theme-boot.js') > 0 && html.indexOf('theme-boot.js') < html.indexOf('namespace.js'));
      assert.deepEqual(stylesheetsOf(page).slice(0, 2), ['src/pages/common/tokens.css', 'src/pages/common/base.css']);
      assert.match(html, /<html lang="en" data-theme="light">/);
    });

    test('has exactly one <h1>, the wordmark', () => {
      assert.equal((read(page).match(/<h1[ >]/g) ?? []).length, 1);
      assert.match(read(page), /<h1[^>]*>(?:<span[^>]*><\/span>)?At Peace<\/h1>/);
    });
  });
}

describe('options custom editors', () => {
  const page = 'src/pages/options/options.html';
  const scripts = scriptsOf(page);

  test('registry.js loads first, and every renderer file on disk is loaded before options.js', () => {
    const dir = 'src/pages/options/renderers';
    const onDisk = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js'));
    const registry = scripts.indexOf(`${dir}/registry.js`);
    assert.ok(registry > 0);
    for (const file of onDisk) {
      const at = scripts.indexOf(`${dir}/${file}`);
      assert.ok(at >= 0, `${file} is not loaded by options.html`);
      if (file !== 'registry.js') assert.ok(at > registry, `${file} must load after registry.js`);
      assert.ok(at < scripts.length - 1, `${file} must load before options.js`);
    }
  });

  test('the stubs other phases overwrite exist', () => {
    for (const f of ['pause-sites.js', 'schedules.js', 'custom-rules.js', 'word-list.js']) {
      assert.ok(existsSync(join(ROOT, 'src/pages/options/renderers', f)), f);
    }
  });
});
