// Helpers shared by the Phase 3c Chromium specs (pause.spec.mjs, focus.spec.mjs, mindful-options.spec.mjs).
//
// youtube.com is STUBBED for most of these flows (context.route fulfils the page with a tiny
// document that has a <video>): DNR redirects happen before Playwright sees the request, so what is
// tested is the real extension, and nothing is loaded from Google, whose captcha rate-limits shared IPs.
// The content scripts still run on the stub because the URL is www.youtube.com.
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ARTIFACTS, evalInExtension, getContext, setStorage, trackErrors } from './harness.mjs';

export const SHOTS = join(ARTIFACTS, 'mindful');

export const STUB_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube (stub)</title></head>' +
  '<body style="font:16px system-ui;padding:40px"><h1>YouTube (stub)</h1><p>A stand-in page for www.youtube.com.</p><video id="v" muted loop></video></body></html>';

/**
 * Serves STUB_HTML for every www.youtube.com request that reaches the network (i.e. was not
 * redirected by the extension). Returns a counter so tests can see what actually loaded.
 */
export async function stubYouTube(context = getContext()) {
  const state = { hits: [] };
  await context.route(/^https:\/\/www\.youtube\.com\//, (route) => {
    state.hits.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB_HTML });
  });
  return state;
}

/** Sends a message to the background, from an extension page. */
export const send = (type, payload) =>
  evalInExtension(({ type: t, payload: p }) => chrome.runtime.sendMessage({ type: t, payload: p }), { type, payload });

/** Wipes storage (local + session) and lets the background settle back to "nothing configured". */
export async function resetStorage() {
  await evalInExtension(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    for (const alarm of await chrome.alarms.getAll()) await chrome.alarms.clear(alarm.name);
  });
  await settle();
}

/** Writes settings (merged over nothing) and waits until the background has applied them. */
export async function configure(settings, extra = {}) {
  await setStorage({ settings, ...extra });
  await settle();
}

/** GET_STATUS reconciles first, so when it answers every rule and alarm matches storage. */
export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80)); // let the storage listener's debounce run
  return send('GET_STATUS');
}

/** The dynamic DNR rules, sorted by id. */
export async function dnrRules() {
  return (await evalInExtension(() => chrome.declarativeNetRequest.getDynamicRules())).sort((a, b) => a.id - b.id);
}

export const readState = async () => (await evalInExtension(() => chrome.storage.local.get(['state', 'stats']))) ?? {};

/** A fresh tab with console/page error tracking, on a 1280x800 viewport. */
export async function newTab(context = getContext()) {
  const page = trackErrors(await context.newPage());
  await page.setViewportSize({ width: 1280, height: 800 });
  return page;
}

/** Saves a screenshot under tests/e2e/artifacts/mindful/<name>.png. */
export async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Saves a screenshot of one element (a row of the options page, say). */
export async function shotEl(locator, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await locator.screenshot({ path });
  return path;
}

/** Waits for the pause page to reach a state: 'breathing' | 'choosing' | 'session' | 'invalid'. */
export async function waitPauseState(page, state, timeout = 10_000) {
  await page.waitForFunction((s) => document.body?.dataset.state === s, state, { timeout });
}

/** Local day key, same as AP.util.dayKey. */
export const today = (at = Date.now()) => {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Errors from OUR code on a tab (extension URLs or the [At Peace] prefix); page noise is ignored. */
export const ourErrors = (page) => page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://'));
