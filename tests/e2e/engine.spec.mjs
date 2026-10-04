// Phase 2a engine E2E in Chromium: live youtube.com with the extension loaded. The scenarios
// (tests/e2e/engine-scenarios.mjs) are shared with the real-Firefox run (tests/firefox/engine.mjs).
import { test, before, after } from 'node:test';
import { launch, close, getContext, setStorage, extensionDiagnostics, trackErrors } from './harness.mjs';
import { SCENARIOS } from './engine-scenarios.mjs';

let page;

before(async () => {
  await launch();
  page = trackErrors(await getContext().newPage());
});

after(async () => {
  await close();
});

const adapter = {
  name: 'chromium',
  async goto(url) {
    // Foreground tab: a background tab gets throttled timers and no animation frames, which would
    // make the frame sampling in the flicker scenarios meaningless.
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/sorry/')) throw Object.assign(new Error('Google served its captcha page (/sorry/)'), { code: 'YT_SORRY' });
  },
  evaluate: (fn, arg) => page.evaluate(fn, arg ?? null),
  async setStorage(obj) {
    await setStorage(obj); // may open the extension helper tab, which steals the foreground
    await page.bringToFront();
  },
  async search(text) {
    const box = page.locator('input[name=search_query]');
    await box.fill(text);
    await box.press('Enter');
  },
  async clickFirstResult() {
    await page.locator('ytd-video-renderer a#video-title').first().click();
  },
  async back() {
    await page.goBack({ waitUntil: 'commit' });
  },
  async ourErrors() {
    const diagnostics = await extensionDiagnostics();
    const fromPage = page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://'));
    return [...diagnostics.runtimeErrors, ...diagnostics.manifestErrors, ...fromPage];
  },
};

for (const scenario of SCENARIOS) {
  test(scenario.name, async (t) => {
    try {
      await adapter.setStorage({ settings: {} }); // every scenario starts from default settings
      await new Promise((resolve) => setTimeout(resolve, 500)); // let the previous page finish reacting before it unloads
      await scenario.run(adapter, t);
    } catch (err) {
      if (err?.code === 'YT_SORRY') return t.skip(`${err.message}; try again later`);
      throw err;
    }
  });
}
