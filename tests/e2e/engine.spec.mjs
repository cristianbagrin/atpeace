// Phase 2a engine E2E in Chromium: live youtube.com with the extension loaded. The scenarios
// (tests/e2e/engine-scenarios.mjs) are shared with the real-Firefox run (tests/firefox/engine.mjs).
import { test, before, after } from 'node:test';
import { launch, close, getContext, setStorage, extensionDiagnostics, trackErrors } from './harness.mjs';
import { SCENARIOS } from './engine-scenarios.mjs';
import { watchGate, liveSkipReason, gate } from './_live.mjs';

let page;

before(async () => {
  await launch();
  page = watchGate(trackErrors(await getContext().newPage()));
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
    const first = page.locator('ytd-video-renderer a#video-title').first();
    // The scenario starts from default settings, so nothing of ours hides results: no results means YouTube served none.
    await first.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
      throw gate('Live YouTube served the search page without any video results');
    });
    await first.click();
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
      const why = await liveSkipReason(err, page);
      if (why) return t.skip(why);
      throw err;
    }
  });
}
