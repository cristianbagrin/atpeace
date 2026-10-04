// Playwright harness: runs the extension in the pre-installed Chromium.
//
// The shipped manifest is Firefox-first. For Chromium we build a *variant* in a temp dir:
//   - `background.scripts`  → `background.service_worker` = src/background/sw-chrome.js, which
//     importScripts() the very same files (Chrome MV3 has no event-page `scripts`).
//   - `browser_specific_settings` is deleted (Chrome only warns about it; removing keeps the
//     extension error list clean so tests can assert it is empty).
// Everything else (content scripts incl. `world: "MAIN"`, DNR, commands, WAR…) is unchanged.
//
// Environment notes (sandbox): all outbound HTTPS goes through $HTTPS_PROXY, and Chromium only
// starts here with `channel: 'chromium'` AND a proxy set. The proxy's CA is already in the NSS
// store; TLS verification stays ON (no ignoreHTTPSErrors, ever).
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ARTIFACTS = join(ROOT, 'tests', 'e2e', 'artifacts');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try {
  ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
} catch (err) {
  throw new Error(`Cannot load the Playwright library from ${PLAYWRIGHT} (set PLAYWRIGHT_PATH to its index.mjs)`, { cause: err });
}

let context = null;
let extensionId = null;
let tempDirs = [];
let helperPage = null;

/**
 * Copies manifest + src + icons into a temp dir with the Chrome-specific manifest rewrites.
 * @returns {Promise<string>} directory to pass to --load-extension
 */
export async function buildChromeVariant() {
  const dir = await mkdtemp(join(tmpdir(), 'at-peace-chrome-'));
  tempDirs.push(dir);
  await cp(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  await cp(join(ROOT, 'icons'), join(dir, 'icons'), { recursive: true });

  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  manifest.background = { service_worker: 'src/background/sw-chrome.js' };
  delete manifest.browser_specific_settings;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

/**
 * Launches Chromium with the extension. Resolves once the extension's service worker is up.
 * @returns {Promise<{ context: import('playwright').BrowserContext, extensionId: string }>}
 */
export async function launch() {
  if (context) throw new Error('harness already launched; call close() first');
  const extensionDir = await buildChromeVariant();
  const profileDir = await mkdtemp(join(tmpdir(), 'at-peace-profile-'));
  tempDirs.push(profileDir);
  await mkdir(ARTIFACTS, { recursive: true });

  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium', // new headless, which (unlike the headless shell) supports extensions
    headless: true,
    proxy,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
  extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}

export function getContext() {
  if (!context) throw new Error('harness not launched');
  return context;
}

export function getExtensionId() {
  if (!extensionId) throw new Error('harness not launched');
  return extensionId;
}

/** @param {string} path path inside the extension, e.g. 'src/pages/popup/popup.html' */
export function extUrl(path) {
  return `chrome-extension://${getExtensionId()}/${path.replace(/^\//, '')}`;
}

/**
 * Opens an extension page in a new tab. Console errors and uncaught exceptions are collected on
 * `page.errors` (an array of strings) from the moment the page exists, including during load.
 * @param {string} path
 */
export async function openExtPage(path) {
  const page = await getContext().newPage();
  trackErrors(page);
  await page.goto(extUrl(path));
  return page;
}

/** Collects console errors and page errors into `page.errors`. */
export function trackErrors(page) {
  page.errors = [];
  page.on('pageerror', (err) => page.errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') page.errors.push(`console.error: ${msg.text()}`);
  });
  return page;
}

// A page that runs in the extension's origin, so it may call extension APIs. Opened lazily and
// reused by setStorage/getStorage/evalInExtension.
async function extensionPage() {
  if (!helperPage || helperPage.isClosed()) {
    helperPage = await openExtPage('src/pages/options/options.html');
  }
  return helperPage;
}

/**
 * Runs `fn(arg)` inside an extension page (where `chrome.*` is available) and returns its result.
 * @template A, R
 * @param {(arg: A) => R | Promise<R>} fn
 * @param {A} [arg]
 * @returns {Promise<R>}
 */
export async function evalInExtension(fn, arg) {
  const page = await extensionPage();
  return page.evaluate(fn, arg);
}

/** Writes keys into chrome.storage.local, evaluated inside an extension page. */
export function setStorage(obj) {
  return evalInExtension((o) => chrome.storage.local.set(o), obj);
}

/** Reads keys (or everything when omitted) from chrome.storage.local. */
export function getStorage(keys) {
  return evalInExtension((k) => chrome.storage.local.get(k ?? null), keys ?? null);
}

/**
 * What chrome://extensions would show for the extension: manifest errors/warnings, install
 * warnings and runtime errors (service worker + content scripts) collected so far.
 */
export async function extensionDiagnostics() {
  const page = await getContext().newPage();
  try {
    await page.goto('chrome://extensions');
    return await page.evaluate(async (id) => {
      const items = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true });
      const mine = items.find((i) => i.id === id);
      return {
        state: mine.state,
        manifestErrors: mine.manifestErrors.map((e) => e.message),
        installWarnings: mine.installWarnings.map((w) => w.message ?? String(w)),
        runtimeErrors: mine.runtimeErrors.map((e) => e.message),
      };
    }, getExtensionId());
  } finally {
    await page.close();
  }
}

/** Saves a screenshot to tests/e2e/artifacts/<name>.png (git-ignored). Returns the file path. */
export async function screenshot(page, name) {
  await mkdir(ARTIFACTS, { recursive: true });
  const path = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Closes the browser and removes the temp extension/profile directories. */
export async function close() {
  const ctx = context;
  context = null;
  extensionId = null;
  helperPage = null;
  try {
    await ctx?.close();
  } finally {
    const dirs = tempDirs;
    tempDirs = [];
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  }
}
