// Phase 0 smoke test, Chromium. Mirrors tests/firefox/smoke.mjs (same four checks) so any
// difference between the two browsers shows up as one passing and one failing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  launch,
  close,
  getContext,
  extUrl,
  openExtPage,
  evalInExtension,
  extensionDiagnostics,
  screenshot,
  trackErrors,
} from './harness.mjs';

before(async () => {
  await launch();
});

after(async () => {
  await close();
});

test('background service worker is alive and answers GET_STATUS', async () => {
  const page = await openExtPage('src/pages/popup/popup.html');
  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATUS' }));
  assert.equal(status.ok, true);
  assert.equal(status.version, '0.1.0');
  // Phase 3c: the full Contract C3 shape.
  for (const key of ['block', 'sessions', 'scheduleOverride', 'activeSchedules', 'today', 'limit']) assert.ok(key in status, `GET_STATUS has ${key}`);

  const unknown = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'NO_SUCH_MESSAGE' }));
  assert.deepEqual(unknown, { ok: false, error: 'unknown' });
  await page.close();
});

test('content scripts run on youtube.com: isolated world and MAIN world', async () => {
  const page = await getContext().newPage();
  trackErrors(page);
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  // Both attributes are written at document_start, so they exist as soon as the DOM does.
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1', null, { timeout: 15_000 });
  const attrs = await page.evaluate(() => ({
    loaded: document.documentElement.getAttribute('data-at-peace-loaded'),
    bridge: document.documentElement.getAttribute('data-at-peace-bridge'),
    host: location.host,
  }));
  assert.equal(attrs.host, 'www.youtube.com');
  assert.equal(attrs.loaded, '1', 'isolated-world content script did not run');
  assert.equal(attrs.bridge, '1', 'MAIN-world content script did not run');
  await screenshot(page, 'smoke-youtube');
  await page.close();
});

test('R1: DNR regexSubstitution redirect to an extension page keeps the full original URL', async () => {
  const pausePage = extUrl('src/pages/pause/pause.html');
  const probe = 'https://www.youtube.com/at-peace-dnr-probe?x=1&y=2';
  await evalInExtension(
    (pageUrl) =>
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [999],
        addRules: [
          {
            id: 999,
            priority: 1,
            action: { type: 'redirect', redirect: { regexSubstitution: `${pageUrl}#\\0` } },
            condition: { regexFilter: '^https://www\\.youtube\\.com/at-peace-dnr-probe.*', resourceTypes: ['main_frame'] },
          },
        ],
      }),
    pausePage,
  );

  const page = await getContext().newPage();
  trackErrors(page);
  try {
    await page.goto(probe, { waitUntil: 'domcontentloaded' });
    assert.ok(page.url().startsWith(pausePage), `expected redirect to the pause page, got ${page.url()}`);
    assert.equal(page.url().slice(page.url().indexOf('#') + 1), probe, 'the original address travels in the hash');
    await page.waitForFunction(() => document.body.dataset.state !== 'loading');
    assert.deepEqual(page.errors, []);
    await screenshot(page, 'smoke-dnr-redirect');
  } finally {
    await page.close();
    await evalInExtension((id) => chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] }), 999);
  }

  const left = await evalInExtension(() => chrome.declarativeNetRequest.getDynamicRules());
  // The extension's own rules (the Gentle preset sends /shorts/ to the normal player) stay; only the probe must be gone.
  assert.ok(!left.some((r) => r.id === 999), 'probe rule was not removed');
});

test('keyboard commands are registered', async (t) => {
  const commands = await evalInExtension(() => chrome.commands.getAll());
  const shortcuts = Object.fromEntries(commands.filter((c) => c.name !== '_execute_action').map((c) => [c.name, c.shortcut]));
  t.diagnostic(`shortcuts assigned by Chromium: ${JSON.stringify(shortcuts)}`);
  assert.deepEqual(Object.keys(shortcuts).sort(), ['focus-25', 'open-picker', 'toggle-enabled']);
  assert.equal(shortcuts['focus-25'], 'Alt+Shift+F');
  assert.equal(shortcuts['open-picker'], 'Alt+Shift+H');
  // Not asserted: this Chromium build leaves Alt+Shift+P (toggle-enabled) unassigned. The shipped
  // target is Firefox, where tests/firefox/smoke.mjs asserts all three suggested shortcuts.
});

for (const [name, path] of [
  ['popup', 'src/pages/popup/popup.html'],
  ['options', 'src/pages/options/options.html'],
  ['pause', 'src/pages/pause/pause.html'],
  ['blocked', 'src/pages/blocked/blocked.html'],
]) {
  test(`${name} page opens without console errors`, async () => {
    const page = await openExtPage(path);
    assert.equal(await page.locator('h1').textContent(), 'At Peace');
    assert.deepEqual(page.errors, []);
    await screenshot(page, `smoke-${name}`);
    await page.close();
  });
}

test('Chromium reports no manifest errors, install warnings or runtime errors for the extension', async () => {
  const diagnostics = await extensionDiagnostics();
  assert.deepEqual(diagnostics, { state: 'ENABLED', manifestErrors: [], installWarnings: [], runtimeErrors: [] });
});
