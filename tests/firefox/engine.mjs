// Phase 2a engine E2E in REAL Firefox (headless, Selenium + geckodriver): the same scenarios as the
// Chromium spec (tests/e2e/engine-scenarios.mjs), against live youtube.com. Firefox is the product
// (Zen), so this is the run that counts. Prerequisite: bash tests/firefox/setup.sh.
import { test, before, after } from 'node:test';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, UUID } from './_harness.mjs';
import { SCENARIOS } from '../e2e/engine-scenarios.mjs';
import { until } from '../helpers/wait.mjs';

let ff;
let driver;

before(async () => {
  ff = await launchFirefox();
  driver = ff.driver;
});

after(async () => {
  await ff?.close();
});

const adapter = {
  name: 'firefox',
  async goto(url) {
    await driver.get(url);
    if ((await driver.getCurrentUrl()).includes('/sorry/')) throw Object.assign(new Error('Google served its captcha page (/sorry/)'), { code: 'YT_SORRY' });
  },
  evaluate: (fn, arg) => driver.executeScript(fn, arg ?? null),
  setStorage: (obj) => ff.setStorage(obj),
  async search(text) {
    const box = await driver.findElement(By.css('input[name=search_query]'));
    await box.sendKeys(text, Key.ENTER);
  },
  async clickFirstResult() {
    // The scenario starts from default settings, so nothing of ours hides results: no results means YouTube served none.
    await until(async () => (await driver.findElements(By.css('ytd-video-renderer a#video-title'))).length > 0, { timeout: 20_000, retryErrors: true }).catch(() => {
      throw Object.assign(new Error('Live YouTube served the search page without any video results'), { code: 'YT_NOT_RENDERED' });
    });
    await (await driver.findElement(By.css('ytd-video-renderer a#video-title'))).click();
  },
  async back() {
    await driver.navigate().back();
  },
  async ourErrors() {
    const pageErrors = ff.pageErrorsSince(0).filter((e) => e.includes(UUID) || e.includes('[At Peace]'));
    return [...(await ff.ourScriptErrors()), ...pageErrors];
  },
};

for (const scenario of SCENARIOS) {
  test(scenario.name, async (t) => {
    try {
      await ff.setStorage({ settings: {} }); // every scenario starts from default settings
      // The previous page reacts to that change asynchronously. Navigating away while its storage read
      // is still in flight makes Firefox log "Promise resolved after context unloaded" for our content
      // script: harmless, but it would fail the "no errors" scenario for a reason that is not a bug.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await scenario.run(adapter, t);
    } catch (err) {
      // Google's captcha can arrive mid-scenario (after a click-through to a video), not only on the first load.
      const captcha = err?.code === 'YT_SORRY' || (await driver.getCurrentUrl().catch(() => '')).includes('/sorry/');
      if (captcha || err?.code === 'YT_NOT_RENDERED') return t.skip(`${captcha ? 'Google served its captcha page (/sorry/)' : err.message}; try again later`);
      throw err;
    }
  });
}
