// Phase 0 smoke test in REAL Firefox (headless) via Selenium + geckodriver.
//
// Prerequisite: `bash tests/firefox/setup.sh` (downloads Firefox + geckodriver into
// ~/.cache/at-peace/). `npm run test:firefox` runs both.
//
// What it proves (same checks as tests/e2e/smoke.spec.mjs in Chromium, plus the Firefox-only risks
// from PLAN §10.1):
//   R1  DNR `regexSubstitution` redirect to a moz-extension:// page works, original URL intact
//   R2  host permission state of a *temporary* install (reported, not asserted)
//   R3  `world: "MAIN"` content script runs
// The extension is built with `web-ext build` first, so what gets tested is the real package.
//
// Error capture: WebDriver BiDi `log.entryAdded` does not report anything from moz-extension://
// pages, so uncaught errors are collected instead by an nsIConsoleListener registered in the
// browser (chrome) context. It sees every script error whose source file is ours, in extension
// pages and in content scripts alike. Not visible to it: explicit `console.error()` calls (the
// Chromium spec covers those).
//
// How extension APIs are reached: the fixed UUID below is pinned through the
// `extensions.webextensions.uuids` pref, so the add-on's origin is known in advance. The test then
// navigates the driver to a moz-extension:// page and runs `browser.*` calls there through
// executeAsyncScript.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = process.env.AT_PEACE_CACHE ?? join(homedir(), '.cache', 'at-peace');
const FIREFOX_BIN = join(CACHE, 'firefox', 'firefox');
const GECKODRIVER_BIN = join(CACHE, 'geckodriver');

const EXT_ID = 'at-peace@cristianbagrin';
// Any fixed UUID: Firefox uses it as the add-on's moz-extension:// host for this profile.
const UUID = '5d1a7e0c-3b2f-4f6a-9a41-7c1f0b5e2a10';
const extUrl = (path) => `moz-extension://${UUID}/${path}`;

for (const f of [FIREFOX_BIN, GECKODRIVER_BIN]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Run: bash tests/firefox/setup.sh`);
    process.exit(2);
  }
}

/** @type {import('selenium-webdriver').WebDriver} */
let driver;
let workDir;
const logEntries = []; // BiDi log.entryAdded events for ordinary web pages (youtube.com)

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'at-peace-ff-'));

  // Build the real package (honours web-ext-config.mjs ignoreFiles).
  execFileSync(join(ROOT, 'node_modules', '.bin', 'web-ext'), ['build', '--artifacts-dir', workDir, '--overwrite-dest'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  const zip = readdirSync(workDir).find((f) => f.endsWith('.zip'));
  assert.ok(zip, 'web-ext build produced no zip');

  // --remote-allow-system-access: recent Firefox (observed on 157) makes WebDriver refuse to
  // *navigate* to privileged URLs (moz-extension:// included) unless this flag is passed, and it also
  // enables the chrome-context scripts used below. Test-only: it is how the extension's own pages
  // get opened in a tab so executeAsyncScript can call `browser.*` there.
  const options = new firefox.Options()
    .setBinary(FIREFOX_BIN)
    .addArguments('-headless', '--remote-allow-system-access')
    .enableBidi();

  // Outbound traffic must use the sandbox proxy (its CA is installed by setup.sh via policies.json;
  // certificate verification is never disabled).
  if (process.env.HTTPS_PROXY) {
    const proxy = new URL(process.env.HTTPS_PROXY);
    const port = Number(proxy.port || 80);
    options.setPreference('network.proxy.type', 1);
    options.setPreference('network.proxy.http', proxy.hostname);
    options.setPreference('network.proxy.http_port', port);
    options.setPreference('network.proxy.ssl', proxy.hostname);
    options.setPreference('network.proxy.ssl_port', port);
    options.setPreference('network.proxy.no_proxies_on', 'localhost, 127.0.0.1');
  }

  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [EXT_ID]: UUID }));
  // Quiet the browser down: no first-run pages, no background network chatter.
  options.setPreference('browser.startup.homepage', 'about:blank');
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  options.setPreference('network.captive-portal-service.enabled', false);
  options.setPreference('network.connectivity-service.enabled', false);
  options.setPreference('extensions.update.enabled', false);
  options.setPreference('app.normandy.enabled', false);
  options.setPreference('browser.safebrowsing.malware.enabled', false);
  options.setPreference('browser.safebrowsing.phishing.enabled', false);

  driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(GECKODRIVER_BIN))
    .build();
  await driver.manage().setTimeouts({ script: 30_000, pageLoad: 60_000 });

  // Collect console errors / uncaught exceptions from every page via WebDriver BiDi.
  const bidi = await driver.getBidi();
  await bidi.subscribe('log.entryAdded');
  const socket = await bidi.socket;
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'log.entryAdded') logEntries.push(msg.params);
    } catch {
      /* not JSON we care about */
    }
  });

  const id = await driver.installAddon(join(workDir, zip), true); // temporary add-on
  assert.equal(id, EXT_ID);

  await startScriptErrorCapture();
});

after(async () => {
  try {
    await driver?.quit();
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
});

// --- helpers -----------------------------------------------------------------------------------

/**
 * Registers an nsIConsoleListener in the browser (chrome) context. Every script error is appended
 * to a JSON array in a pref, because chrome-context sandboxes do not persist variables between
 * executeScript calls and prefs do.
 */
async function startScriptErrorCapture() {
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(() => {
      Services.prefs.setStringPref('at-peace.test.errors', '[]');
      const errors = [];
      Services.console.registerListener({
        observe(message) {
          let scriptError;
          try {
            scriptError = message.QueryInterface(Ci.nsIScriptError);
          } catch {
            return; // plain console message, not a script error
          }
          // flags: 0 error, 1 warning, 2 exception, 4 strict, 8 info. Keep errors and exceptions.
          if (scriptError.flags & (1 | 8)) return;
          errors.push({ message: scriptError.errorMessage, source: scriptError.sourceName });
          Services.prefs.setStringPref('at-peace.test.errors', JSON.stringify(errors));
        },
        QueryInterface: ChromeUtils.generateQI(['nsIConsoleListener']),
      });
    });
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

/** All script errors seen so far that come from our extension's files. */
async function ourScriptErrors() {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const json = await driver.executeScript(() => Services.prefs.getStringPref('at-peace.test.errors', '[]'));
    return JSON.parse(json)
      .filter((e) => String(e.source).startsWith(`moz-extension://${UUID}/`))
      .map((e) => `${e.source}: ${e.message}`);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

/** Opens an extension page; returns the script errors from our files that appeared while it loaded. */
async function openExtPage(path) {
  const before = (await ourScriptErrors()).length;
  await driver.get(extUrl(path));
  await driver.sleep(500); // errors are forwarded from the content process asynchronously
  return (await ourScriptErrors()).slice(before);
}

/** BiDi console errors on ordinary pages since index `from`, as readable strings. */
function pageErrorsSince(from) {
  return logEntries
    .slice(from)
    .filter((e) => e.level === 'error')
    .map((e) => `${e.type}: ${e.text}`);
}

/** Runs `browser.runtime.sendMessage` from the current extension page. */
function sendMessage(message) {
  return driver.executeAsyncScript((msg, done) => {
    browser.runtime.sendMessage(msg).then(done, (e) => done({ __error: String(e) }));
  }, message);
}

const findings = {};

// --- tests -------------------------------------------------------------------------------------

test('extension loads as a temporary add-on and its background answers GET_STATUS', async () => {
  const errors = await openExtPage('src/pages/popup/popup.html');
  assert.deepEqual(errors, []);

  const status = await sendMessage({ type: 'GET_STATUS' });
  // Phase 3c answers the full Contract C3 shape (src/background/sessions.js), not just { ok, version }.
  assert.equal(status.ok, true);
  assert.equal(status.version, '0.1.0');
  for (const key of ['block', 'sessions', 'scheduleOverride', 'activeSchedules', 'today', 'limit']) assert.ok(key in status, `GET_STATUS has ${key}`);

  const unknown = await sendMessage({ type: 'NO_SUCH_MESSAGE' });
  assert.deepEqual(unknown, { ok: false, error: 'unknown' });

  const manifest = await driver.executeAsyncScript((done) => done(browser.runtime.getManifest()));
  assert.equal(manifest.browser_specific_settings.gecko.id, EXT_ID);
  // The load-order list grows with every phase (tests/unit/manifest.test.mjs guards its content);
  // here it only matters that Firefox sees the whole list, background.js last.
  // (getManifest() reports them as absolute moz-extension:// URLs.)
  assert.ok(manifest.background.scripts.at(-1).endsWith('/src/background/background.js'));
  assert.ok(manifest.background.scripts.some((script) => script.endsWith('/src/shared/settings.js')));
});

test('Firefox reports no manifest warnings or errors for the extension', async () => {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const report = await driver.executeScript(() => {
      const extension = WebExtensionPolicy.getByID('at-peace@cristianbagrin').extension;
      return { warnings: [...extension.warnings], errors: [...extension.errors] };
    });
    assert.deepEqual(report, { warnings: [], errors: [] });
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
});

test('R2: host permission state on a temporary install (reported)', async (t) => {
  await openExtPage('src/pages/popup/popup.html');
  const perms = await driver.executeAsyncScript((done) => {
    Promise.all([
      browser.permissions.contains({ origins: ['*://*.youtube.com/*'] }),
      browser.permissions.contains({ origins: ['*://*/*'] }),
      browser.permissions.getAll(),
    ]).then(([youtube, allUrls, all]) => done({ youtube, allUrls, all }), (e) => done({ __error: String(e) }));
  });
  findings.R2 = perms;
  t.diagnostic(`R2 permissions.contains(*://*.youtube.com/*) = ${perms.youtube}`);
  t.diagnostic(`R2 permissions.contains(*://*/*) (optional) = ${perms.allUrls}`);
  t.diagnostic(`R2 permissions.getAll() = ${JSON.stringify(perms.all)}`);
  assert.equal(typeof perms.youtube, 'boolean');
});

test('content scripts run on youtube.com: isolated world and MAIN world (R3)', async (t) => {
  const from = logEntries.length;
  const scriptErrorsBefore = (await ourScriptErrors()).length;
  await driver.get('https://www.youtube.com/');
  await driver.wait(
    async () => (await driver.executeScript(() => document.documentElement.getAttribute('data-at-peace-loaded'))) === '1',
    20_000,
    'isolated-world content script never set data-at-peace-loaded (R2: host permission missing?)',
  );
  const attrs = await driver.executeScript(() => ({
    loaded: document.documentElement.getAttribute('data-at-peace-loaded'),
    bridge: document.documentElement.getAttribute('data-at-peace-bridge'),
    host: location.host,
  }));
  findings.R3 = attrs.bridge === '1';
  t.diagnostic(`R3 world:MAIN content script ran = ${attrs.bridge === '1'}`);
  assert.equal(attrs.host, 'www.youtube.com');
  assert.equal(attrs.loaded, '1', 'isolated-world content script did not run');
  assert.equal(attrs.bridge, '1', 'MAIN-world content script did not run');

  await driver.sleep(500);
  const ours = [
    ...(await ourScriptErrors()).slice(scriptErrorsBefore),
    ...pageErrorsSince(from).filter((e) => e.includes(UUID) || e.includes('[At Peace]')),
  ];
  assert.deepEqual(ours, [], 'errors from our code on youtube.com');
});

test('R1: DNR regexSubstitution redirect to a moz-extension page keeps the full original URL', async (t) => {
  await openExtPage('src/pages/popup/popup.html');
  const pausePage = extUrl('src/pages/pause/pause.html');
  const probe = 'https://www.youtube.com/at-peace-dnr-probe?x=1&y=2';

  const added = await driver.executeAsyncScript((pageUrl, done) => {
    browser.declarativeNetRequest
      .updateDynamicRules({
        removeRuleIds: [999],
        addRules: [
          {
            id: 999,
            priority: 1,
            action: { type: 'redirect', redirect: { regexSubstitution: `${pageUrl}#\\0` } },
            condition: { regexFilter: '^https://www\\.youtube\\.com/at-peace-dnr-probe.*', resourceTypes: ['main_frame'] },
          },
        ],
      })
      .then(() => done({ ok: true }), (e) => done({ ok: false, error: String(e) }));
  }, pausePage);
  assert.deepEqual(added, { ok: true }, 'updateDynamicRules rejected the probe rule');

  try {
    const before = (await ourScriptErrors()).length;
    let navError = null;
    try {
      await driver.get(probe);
    } catch (err) {
      navError = String(err.message ?? err);
    }
    const finalUrl = await driver.getCurrentUrl();
    t.diagnostic(`R1 navigated to ${probe}`);
    t.diagnostic(`R1 landed on ${finalUrl}${navError ? ` (driver error: ${navError})` : ''}`);
    findings.R1 = finalUrl.startsWith(pausePage);
    assert.ok(finalUrl.startsWith(pausePage), `expected redirect to the pause page, got ${finalUrl}`);

    const shown = finalUrl.slice(finalUrl.indexOf('#') + 1);
    t.diagnostic(`R1 the hash carries ${shown}`);
    assert.equal(shown, probe, 'the original address travels in the hash');
    await driver.wait(async () => (await driver.executeScript(() => document.body.dataset.state)) !== 'loading', 5_000);
    assert.deepEqual((await ourScriptErrors()).slice(before), []);
  } finally {
    await driver.get(extUrl('src/pages/popup/popup.html'));
    await driver.executeAsyncScript((done) => {
      browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [999] }).then(() => done(true), (e) => done(String(e)));
    });
  }

  const left = await driver.executeAsyncScript((done) => {
    browser.declarativeNetRequest.getDynamicRules().then(done, (e) => done({ __error: String(e) }));
  });
  // The extension's own rules (the Gentle preset sends /shorts/ to the normal player) stay; only the probe must be gone.
  assert.ok(Array.isArray(left) && !left.some((r) => r.id === 999), 'probe rule was not removed');
});

test('keyboard commands are registered with their suggested shortcuts', async () => {
  await openExtPage('src/pages/popup/popup.html');
  const commands = await driver.executeAsyncScript((done) => {
    browser.commands.getAll().then(done, (e) => done({ __error: String(e) }));
  });
  const shortcuts = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
  assert.deepEqual(shortcuts, { 'toggle-enabled': 'Alt+Shift+P', 'focus-25': 'Alt+Shift+F', 'open-picker': 'Alt+Shift+H' });
});

for (const [name, path] of [
  ['popup', 'src/pages/popup/popup.html'],
  ['options', 'src/pages/options/options.html'],
  ['pause', 'src/pages/pause/pause.html'],
  ['blocked', 'src/pages/blocked/blocked.html'],
]) {
  test(`${name} page opens without console errors`, async () => {
    const errors = await openExtPage(path);
    const heading = await driver.executeScript(() => document.querySelector('h1')?.textContent);
    assert.equal(heading, 'At Peace');
    assert.deepEqual(errors, []);
  });
}

test('findings summary', (t) => {
  t.diagnostic(`findings: ${JSON.stringify(findings)}`);
});
