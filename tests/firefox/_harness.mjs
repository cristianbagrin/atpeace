// Shared real-Firefox harness for the Selenium specs in this folder (headless Firefox + geckodriver
// from ~/.cache/at-peace, set up by tests/firefox/setup.sh). `smoke.mjs` (Phase 0) carries its own
// copy of this boilerplate; new specs should import from here.
//
//   const ff = await launchFirefox();      // builds the real package with web-ext, installs it temporarily
//   ff.driver                              // selenium WebDriver
//   await ff.setStorage({...}) / ff.getStorage(keys)     // storage.local, via an extension page
//   await ff.openExtPage('src/pages/options/options.html')
//   await ff.ourScriptErrors()             // script errors from OUR files (console listener in chrome context)
//   await ff.close()
//
// Environment notes: same as the Chromium harness. The sandbox proxy and its CA are configured by
// setup.sh; certificate verification is never disabled.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { until } from '../helpers/wait.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = process.env.AT_PEACE_CACHE ?? join(homedir(), '.cache', 'at-peace');
const FIREFOX_BIN = join(CACHE, 'firefox', 'firefox');
const GECKODRIVER_BIN = join(CACHE, 'geckodriver');

export const EXT_ID = 'at-peace@cristianbagrin';
/** Any fixed UUID: Firefox uses it as the add-on's moz-extension:// host for the profile. */
export const UUID = '5d1a7e0c-3b2f-4f6a-9a41-7c1f0b5e2a10';
export const extUrl = (path) => `moz-extension://${UUID}/${path}`;

export { firefox };

/**
 * @param {{ prefs?: Record<string, string|number|boolean> }} [config] extra Firefox preferences, applied last
 * @returns {Promise<{
 *   driver: import('selenium-webdriver').WebDriver,
 *   logEntries: any[],
 *   openExtPage: (path: string) => Promise<string[]>,
 *   setStorage: (obj: object) => Promise<void>,
 *   getStorage: (keys?: string|string[]|null) => Promise<any>,
 *   ourScriptErrors: () => Promise<string[]>,
 *   pageErrorsSince: (from: number) => string[],
 *   close: () => Promise<void>,
 * }>}
 */
export async function launchFirefox({ prefs = {} } = {}) {
  for (const f of [FIREFOX_BIN, GECKODRIVER_BIN]) {
    if (!existsSync(f)) throw new Error(`Missing ${f}. Run: bash tests/firefox/setup.sh`);
  }
  const workDir = mkdtempSync(join(tmpdir(), 'at-peace-ff-'));

  // Build the real package (honours web-ext-config.mjs ignoreFiles) so what is tested is what ships.
  execFileSync(join(ROOT, 'node_modules', '.bin', 'web-ext'), ['build', '--artifacts-dir', workDir, '--overwrite-dest'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  const zip = readdirSync(workDir).find((f) => f.endsWith('.zip'));
  assert.ok(zip, 'web-ext build produced no zip');

  const options = new firefox.Options()
    .setBinary(FIREFOX_BIN)
    .addArguments('-headless', '--remote-allow-system-access') // see smoke.mjs for why
    .enableBidi();

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
  options.setPreference('browser.startup.homepage', 'about:blank');
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  options.setPreference('network.captive-portal-service.enabled', false);
  options.setPreference('network.connectivity-service.enabled', false);
  options.setPreference('extensions.update.enabled', false);
  options.setPreference('app.normandy.enabled', false);
  // Per-spec extras (e.g. Phase 3c resolves a test hostname to localhost and auto-grants optional permissions).
  for (const [name, value] of Object.entries(prefs)) options.setPreference(name, value);
  options.setPreference('browser.safebrowsing.malware.enabled', false);
  options.setPreference('browser.safebrowsing.phishing.enabled', false);

  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(GECKODRIVER_BIN))
    .build();
  await driver.manage().setTimeouts({ script: 30_000, pageLoad: 60_000 });

  const logEntries = [];
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

  // nsIConsoleListener in the browser (chrome) context: collects script errors from every
  // extension file into a pref (chrome sandboxes do not keep variables between calls).
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
            return;
          }
          if (scriptError.flags & (1 | 8)) return; // warnings, infos
          errors.push({ message: scriptError.errorMessage, source: scriptError.sourceName });
          Services.prefs.setStringPref('at-peace.test.errors', JSON.stringify(errors));
        },
        QueryInterface: ChromeUtils.generateQI(['nsIConsoleListener']),
      });
    });
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }

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

  /** Opens an extension page; returns script errors from our files that appeared while it loaded. */
  async function openExtPage(path) {
    const before = (await ourScriptErrors()).length;
    await driver.get(extUrl(path));
    await driver.sleep(500);
    return (await ourScriptErrors()).slice(before);
  }

  // A dedicated tab on an extension page, so storage can be changed while the page under test
  // (youtube.com) stays open in its own tab. Created on first use.
  let extHandle = null;
  async function inExtensionTab(fn) {
    const original = await driver.getWindowHandle();
    if (extHandle === null) {
      await driver.switchTo().newWindow('tab');
      extHandle = await driver.getWindowHandle();
      await driver.get(extUrl('src/pages/popup/popup.html'));
    } else {
      await driver.switchTo().window(extHandle);
    }
    try {
      return await fn();
    } finally {
      await driver.switchTo().window(original);
    }
  }

  /** storage.local.set, through the extension tab. */
  async function setStorage(obj) {
    const res = await inExtensionTab(() =>
      driver.executeAsyncScript((o, done) => {
        browser.storage.local.set(o).then(() => done({ ok: true }), (e) => done({ error: String(e) }));
      }, obj),
    );
    assert.deepEqual(res, { ok: true });
  }

  /** storage.local.get, through the extension tab. */
  function getStorage(keys) {
    return inExtensionTab(() =>
      driver.executeAsyncScript((k, done) => {
        browser.storage.local.get(k).then(done, (e) => done({ error: String(e) }));
      }, keys ?? null),
    );
  }

  // A fresh install is not finished when installAddon() resolves: onInstalled writes `meta` and applies the Gentle
  // preset (only if no settings exist yet) a moment later. A spec that sets its own settings first thing would race
  // it, so wait for that work to be done before handing the browser over.
  await until(
    async () => {
      const { meta, settings } = await getStorage(['meta', 'settings']);
      return Boolean(meta?.installedAt) && Object.keys(settings ?? {}).length > 0;
    },
    { what: 'the install work (meta + Gentle preset) to finish', timeout: 20_000, retryErrors: true },
  );

  return {
    driver,
    logEntries,
    openExtPage,
    setStorage,
    getStorage,
    ourScriptErrors,
    pageErrorsSince: (from) =>
      logEntries
        .slice(from)
        .filter((e) => e.level === 'error')
        .map((e) => `${e.type}: ${e.text}`),
    async close() {
      try {
        await driver.quit();
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
}
