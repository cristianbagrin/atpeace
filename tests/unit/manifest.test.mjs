// Guards the invariants PLAN §3.1 asks every agent to maintain by hand: load-order lists that must
// stay in sync, files that must exist, and the CSP rules for extension pages.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readdirSync } from 'node:fs';
import { ROOT, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const exists = (rel) => existsSync(join(ROOT, rel));

describe('manifest.json', () => {
  test('identity and platform', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'At Peace');
    assert.equal(manifest.version, JSON.parse(read('package.json')).version);
    const gecko = manifest.browser_specific_settings.gecko;
    assert.equal(gecko.id, 'at-peace@cristianbagrin');
    assert.equal(gecko.strict_min_version, '140.0');
    assert.deepEqual(gecko.data_collection_permissions, { required: ['none'] });
  });

  test('permissions', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'declarativeNetRequest', 'scripting', 'storage']);
    assert.deepEqual(manifest.host_permissions, ['*://*.youtube.com/*']);
    assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
  });

  test('keyboard commands (PLAN §8.5)', () => {
    const keys = Object.fromEntries(Object.entries(manifest.commands).map(([k, v]) => [k, v.suggested_key.default]));
    const mac = Object.fromEntries(Object.entries(manifest.commands).map(([k, v]) => [k, v.suggested_key.mac]));
    assert.deepEqual(keys, { 'toggle-enabled': 'Alt+Shift+P', 'focus-25': 'Alt+Shift+F', 'open-picker': 'Alt+Shift+H' });
    // Written out for the Mac too (Alt is Option there), so the key is explicit rather than inherited.
    assert.deepEqual(mac, { 'toggle-enabled': 'Alt+Shift+P', 'focus-25': 'Alt+Shift+F', 'open-picker': 'Alt+Shift+H' });
    for (const cmd of Object.values(manifest.commands)) assert.ok(cmd.description);
  });

  test('every file the manifest references exists', () => {
    const files = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      manifest.action.default_popup,
      manifest.options_ui.page,
      ...manifest.background.scripts,
      ...manifest.content_scripts.flatMap((cs) => cs.js),
    ];
    for (const f of files) assert.ok(exists(f), `missing: ${f}`);
  });

  test('web_accessible_resources cover the DNR redirect targets for all URLs', () => {
    const wars = manifest.web_accessible_resources;
    assert.ok(wars.every((w) => w.matches.includes('<all_urls>')));
    const resources = wars.flatMap((w) => w.resources);
    for (const dir of ['pause', 'blocked']) {
      assert.ok(resources.includes(`src/pages/${dir}/*`), dir);
      assert.ok(exists(`src/pages/${dir}/${dir}.html`), dir);
    }
  });
});

describe('script load-order lists stay in sync', () => {
  test('background.scripts starts with the core scripts, namespace first', () => {
    assert.deepEqual(manifest.background.scripts.slice(0, CORE_SCRIPTS.length), CORE_SCRIPTS);
    assert.equal(manifest.background.scripts.at(-1), 'src/background/background.js');
  });

  test('src/background/sw-chrome.js importScripts() the same list as background.scripts', () => {
    const src = read('src/background/sw-chrome.js');
    const call = /importScripts\(([^)]*)\)/s.exec(src);
    assert.ok(call, 'importScripts call not found');
    const listed = [...call[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // paths in sw-chrome.js are relative to src/background/
    const resolved = listed.map((p) => posix.normalize(posix.join('src/background', p)));
    assert.deepEqual(resolved, manifest.background.scripts);
  });

  test('every content script entry in the isolated world starts with the core scripts', () => {
    const isolated = manifest.content_scripts.filter((cs) => cs.world !== 'MAIN');
    assert.ok(isolated.length > 0);
    for (const cs of isolated) assert.deepEqual(cs.js.slice(0, CORE_SCRIPTS.length), CORE_SCRIPTS);
  });

  test('background.scripts = core + schema stack + (background modules, redirect catalog) + background.js last', () => {
    const scripts = manifest.background.scripts;
    const head = CORE_SCRIPTS.length + SCHEMA_SCRIPTS.length;
    assert.deepEqual(scripts.slice(0, head), [...CORE_SCRIPTS, ...SCHEMA_SCRIPTS]);
    assert.equal(scripts.at(-1), 'src/background/background.js');
    // Between: the settings lock (Phase 4b: pages + background only), the background modules (Phase 3c) and the shared YouTube redirect catalog (Contract C2).
    for (const f of scripts.slice(head, -1)) assert.match(f, /^src\/background\/[\w-]+\.js$|^src\/sites\/youtube\/redirects\.js$|^src\/shared\/lock\.js$/, f);
    assert.equal(scripts[head], 'src/shared/lock.js', 'the lock loads right after the schema stack');
    assert.ok(!manifest.content_scripts.some((cs) => cs.js.includes('src/shared/lock.js')), 'content scripts do not load the lock');
  });

  test('YouTube content script = core + schema stack, then engine, page, (features), main last', () => {
    const youtube = manifest.content_scripts.find((cs) => cs.world !== 'MAIN');
    assert.deepEqual(youtube.js.slice(0, CORE_SCRIPTS.length + SCHEMA_SCRIPTS.length), [...CORE_SCRIPTS, ...SCHEMA_SCRIPTS]);
    const rest = youtube.js.slice(CORE_SCRIPTS.length + SCHEMA_SCRIPTS.length);
    assert.deepEqual([rest[0], rest[1]], ['src/content/engine.js', 'src/sites/youtube/page.js']);
    assert.equal(rest.at(-1), 'src/sites/youtube/main.js');
    // Everything between page.js and main.js is a feature file, or a helper the features share:
    // the bridge client and the redirect catalog (Contract C2, Phase 3b), the overlay and the pause/focus guard core (Phase 3c).
    const SHARED = ['src/sites/youtube/bridge-client.js', 'src/sites/youtube/redirects.js', 'src/content/overlay.js', 'src/content/guard-core.js', 'src/content/picker.js'];
    for (const f of rest.slice(2, -1)) {
      if (!SHARED.includes(f)) assert.match(f, /^src\/sites\/youtube\/features\/[\w-]+\.js$/, f);
    }
    // Helpers load before the features that call them.
    const at = (f) => rest.indexOf(f);
    for (const f of ['session-guard', 'time-tracker']) {
      assert.ok(at(`src/sites/youtube/features/${f}.js`) > at('src/content/guard-core.js'), `${f} loads after guard-core.js`);
      assert.ok(at('src/content/guard-core.js') > at('src/content/overlay.js'), 'guard-core.js loads after overlay.js');
    }
  });

  test('every schema file on disk is in the load order (a forgotten file would silently not register)', () => {
    const onDisk = [
      ...readdirSync(join(ROOT, 'src/shared/schema')).map((f) => `src/shared/schema/${f}`),
      ...readdirSync(join(ROOT, 'src/sites/youtube/schema')).map((f) => `src/sites/youtube/schema/${f}`),
    ].filter((f) => f.endsWith('.js'));
    for (const f of onDisk) {
      assert.ok(manifest.background.scripts.includes(f), `background.scripts misses ${f}`);
      assert.ok(manifest.content_scripts[0].js.includes(f), `content script misses ${f}`);
    }
  });

  test('MAIN-world scripts never load the AtPeace namespace or extension API', () => {
    for (const cs of manifest.content_scripts.filter((c) => c.world === 'MAIN')) {
      for (const f of cs.js) {
        assert.ok(!CORE_SCRIPTS.includes(f), f);
        const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may mention them
        assert.doesNotMatch(code, /AtPeace|\bchrome\.|\bbrowser\./, `${f} must not use extension APIs`);
      }
    }
  });
});

describe('extension pages obey the CSP rules (PLAN §3.2)', () => {
  const pages = [
    manifest.action.default_popup,
    manifest.options_ui.page,
    'src/pages/pause/pause.html',
    'src/pages/blocked/blocked.html',
    'src/pages/welcome/welcome.html',
  ];

  for (const page of pages) {
    test(`${page}: no inline scripts or handlers, every <script src> exists`, () => {
      const html = read(page);
      assert.match(html, /<title>[^<]+<\/title>/);
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script>');
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
      assert.doesNotMatch(html, /javascript:/i);
      const dir = posix.dirname(page);
      for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) {
        const target = posix.normalize(posix.join(dir, m[1]));
        assert.ok(exists(target), `${page} loads missing ${target}`);
      }
    });
  }
});
