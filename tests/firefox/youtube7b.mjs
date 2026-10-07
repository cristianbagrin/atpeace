// Phase 7b in REAL Firefox (headless, Selenium + geckodriver), on offline snapshots served by a local http server
// (tests/e2e/_yt-fixture.mjs; no traffic to Google). Firefox is the product (Zen): the selectors of this phase use
// `:has(+ …)`, `:nth-last-child(1 of …)` and attribute gates, and this is where they are proved.
//   1. card metadata: only the number goes (item 7), in every layout of tests/e2e/_card-variants.mjs
// Prerequisite: bash tests/firefox/setup.sh. Skipped without the snapshots.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFirefox, ROOT, NAVIGATION_NOISE } from './_harness.mjs';
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';
import { buildVariantsInPage, partsVisibleInPage } from '../e2e/_card-variants.mjs';
import { until } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'round1', '7b');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VIEWS = 'yt.general.hideViewCounts';
const DATES = 'yt.general.hideUploadDates';

const HAVE = fixturesAvailable(['channel-home']);

describe('7b on offline snapshots', { skip: HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)' }, () => {
  let ff;
  let server;
  let driver;
  const run = (fn, arg) => driver.executeScript(fn, arg ?? null);

  before(async () => {
    server = await startFixtureServer();
    ff = await launchFirefox({
      prefs: {
        'network.dns.localDomains': 'www.youtube.com',
        'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
        'network.stricttransportsecurity.preloadlist': false,
      },
    });
    driver = ff.driver;
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    await mkdir(SHOTS, { recursive: true });
  });
  after(async () => {
    await ff?.close();
    await server?.close();
  });

  const configure = async (settings) => {
    await ff.setStorage({ settings });
    await sleep(300);
  };
  async function open(path) {
    await driver.get(`${server.origin}${path}`);
    await until(() => run(() => document.documentElement.hasAttribute('data-at-peace') && document.documentElement.hasAttribute('data-at-peace-page')), 'the engine', 20_000);
    await until(() => run(() => document.documentElement.getAttribute('data-fixture-ready') === '1'), 'the snapshot', 20_000);
  }
  const ourErrors = async () => [...(await ff.ourScriptErrors()), ...ff.pageErrorsSince(0).filter((e) => e.includes('moz-extension://') || e.includes('[At Peace]'))].filter((e) => !NAVIGATION_NOISE.test(e));
  const shot = async (name) => writeFile(join(SHOTS, `ff-${name}.png`), await driver.takeScreenshot(), 'base64');

  describe('card metadata: only the number goes', () => {
    // The same table as tests/e2e/card-metrics.spec.mjs (Chromium); kept in step by hand, it is short.
    const ALL = ['channel', 'tick', 'play', 'views', 'sep-1', 'date'];
    const EXPECT = {
      'two-rows': { none: ALL, views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'play', 'views'], both: ['channel', 'tick'] },
      'two-rows-plain': { none: ['channel', 'tick', 'views', 'sep-1', 'date'], views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
      'one-row': { none: ['channel', 'tick', 'sep-1', 'play', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'play', 'views'], both: ['channel', 'tick'] },
      'one-row-plain': { none: ['channel', 'tick', 'sep-1', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
      'no-channel': { none: ['play', 'views', 'sep-1', 'date'], views: ['date'], dates: ['play', 'views'], both: [] },
      'live-two-rows': { none: ['channel', 'tick', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
      'live-one-row': { none: ['channel', 'tick', 'sep-1', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
      playlist: { none: ALL, views: ALL, dates: ALL, both: ALL },
    };
    let names;

    before(async () => {
      await configure({});
      await open('/@MrBeast/featured?fixture=channel-home');
      names = await run(buildVariantsInPage);
    });

    for (const [mode, settings] of [['none', {}], ['views', { [VIEWS]: true }], ['dates', { [DATES]: true }], ['both', { [VIEWS]: true, [DATES]: true }]]) {
      test(`${mode}: what stays in every layout`, async () => {
        assert.deepEqual(names, Object.keys(EXPECT));
        await configure(settings);
        const want = Object.keys(settings);
        await until(
          () => run((ids) => { const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' '); return ids.every((id) => tokens.includes(id)) && (ids.length > 0 || !tokens.includes('yt.general.hideViewCounts')); }, want),
          'the settings to reach the page',
          10_000,
        );
        await sleep(150);
        for (const name of names) assert.deepEqual(await run(partsVisibleInPage, name), EXPECT[name][mode], `${name}, ${mode}`);
        await shot(`card-metrics-${mode}`);
      });
    }

    test('no errors from the extension', async () => {
      assert.deepEqual(await ourErrors(), []);
    });
  });
});
