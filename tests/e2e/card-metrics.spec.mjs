// Phase 7b, item 7 (Chromium, offline snapshots): "Hide view counts" and "Hide upload dates" take away the number
// (and the separator that went with it) and nothing else, whatever the layout of the card's metadata. The first
// round of user feedback showed "✓386K1d ago" on a signed-in home card: the channel name gone, the separators gone,
// the number still there. The cards here are real lockups from a snapshot re-arranged into every layout the rules
// must cope with (tests/e2e/_card-variants.mjs), so the channel name staying is asserted, not assumed.
// Screenshots go to tests/e2e/artifacts/round1/7b/.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, setStorage, trackErrors, ARTIFACTS } from './harness.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';
import { buildVariantsInPage, partsVisibleInPage } from './_card-variants.mjs';

const SHOTS = join(ARTIFACTS, 'round1', '7b');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VIEWS = 'yt.general.hideViewCounts';
const DATES = 'yt.general.hideUploadDates';
const have = fixturesAvailable(['channel-home']);

/** What stays, per layout and setting (roles; see _card-variants.mjs). */
const EXPECT = {
  'two-rows': { none: ['channel', 'tick', 'play', 'views', 'sep-1', 'date'], views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'play', 'views'], both: ['channel', 'tick'] },
  'two-rows-plain': { none: ['channel', 'tick', 'views', 'sep-1', 'date'], views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
  // The separator before what is left stays, so "channel ✓ • 1d ago" keeps its spacing.
  'one-row': { none: ['channel', 'tick', 'sep-1', 'play', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'play', 'views'], both: ['channel', 'tick'] },
  'one-row-plain': { none: ['channel', 'tick', 'sep-1', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
  'no-channel': { none: ['play', 'views', 'sep-1', 'date'], views: ['date'], dates: ['play', 'views'], both: [] },
  // "watching" is the live stream's view count; it has no date.
  'live-two-rows': { none: ['channel', 'tick', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
  'live-one-row': { none: ['channel', 'tick', 'sep-1', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
  // Playlist cards are not videos: their rows are left alone.
  playlist: { none: ['channel', 'tick', 'play', 'views', 'sep-1', 'date'], views: ['channel', 'tick', 'play', 'views', 'sep-1', 'date'], dates: ['channel', 'tick', 'play', 'views', 'sep-1', 'date'], both: ['channel', 'tick', 'play', 'views', 'sep-1', 'date'] },
};

describe('card metadata: only the number goes', { skip: have ? false : 'tests/e2e/artifacts/research/channel-home.dom.json is not on this machine' }, () => {
  let page;
  let variants;

  before(async () => {
    await launch();
    await mkdir(SHOTS, { recursive: true });
    await installYouTubeFixtures(getContext());
    page = trackErrors(await getContext().newPage());
    await page.setViewportSize({ width: 1440, height: 900 });
    await setStorage({ settings: {} });
    await page.goto('https://www.youtube.com/@MrBeast/featured?fixture=channel-home', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.hasAttribute('data-at-peace'), null, { timeout: 15_000 });
    variants = await page.evaluate(buildVariantsInPage);
  });
  after(async () => close());

  async function apply(settings) {
    await setStorage({ settings });
    const want = Object.keys(settings).filter((id) => settings[id] === true);
    await page.waitForFunction((ids) => {
      const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ');
      return ids.every((id) => tokens.includes(id)) && ['yt.general.hideViewCounts', 'yt.general.hideUploadDates', 'yt.general.hideBadges'].filter((id) => !ids.includes(id)).every((id) => !tokens.includes(id));
    }, want, { timeout: 10_000 });
    await sleep(150);
  }

  test('every layout is built', () => {
    assert.deepEqual(variants, Object.keys(EXPECT));
  });

  for (const [mode, settings] of [['none', {}], ['views', { [VIEWS]: true }], ['dates', { [DATES]: true }], ['both', { [VIEWS]: true, [DATES]: true }]]) {
    test(`${mode === 'none' ? 'nothing on' : `hide ${mode === 'both' ? 'view counts and upload dates' : mode === 'views' ? 'view counts' : 'upload dates'}`}: what stays, in every layout`, async () => {
      await apply(settings);
      const seen = {};
      for (const name of variants) seen[name] = await page.evaluate(partsVisibleInPage, name);
      for (const name of variants) assert.deepEqual(seen[name], EXPECT[name][mode], `${name}, ${mode}`);
      await page.mouse.move(2, 2);
      await page.screenshot({ path: join(SHOTS, `card-metrics-${mode}.png`), clip: { x: 0, y: 0, width: 1440, height: 640 } });
    });
  }

  test('hide badges and verified ticks: the tick goes, the channel name, numbers and separators stay (every layout)', async () => {
    await apply({ 'yt.general.hideBadges': true });
    for (const name of variants) {
      assert.deepEqual(await page.evaluate(partsVisibleInPage, name), EXPECT[name].none.filter((role) => role !== 'tick'), `${name}: only the tick goes`);
    }
    await apply({});
  });

  test('the channel name is still readable text, not just present', async () => {
    await apply({ [VIEWS]: true });
    const text = await page.evaluate(() => [...document.querySelectorAll('yt-lockup-view-model[data-variant]')].map((c) => [c.getAttribute('data-variant'), c.querySelector('[data-part="channel"]')?.innerText ?? null]));
    for (const [name, channel] of text) {
      if (name === 'no-channel') continue;
      assert.ok(channel && channel.trim().length > 1, `${name}: channel text ${JSON.stringify(channel)}`);
    }
    await apply({});
  });

  test('no errors from the extension', async () => {
    assert.deepEqual(page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://')), []);
  });
});

/** Runs in the page: how many channel names, view counts and dates of the cards on screen are laid out. */
export function surfaceReportInPage() {
  const shown = (el) => el.getClientRects().length > 0;
  const n = { cards: 0, channel: 0, views: 0, dates: 0 };
  for (const card of document.querySelectorAll('yt-lockup-view-model')) {
    if (card.closest('[hidden]') || card.querySelector('yt-collection-thumbnail-view-model')) continue;
    n.cards++;
    const rows = [...card.querySelectorAll('.ytContentMetadataViewModelMetadataRow')];
    const channelRow = rows.find((r) => !r.querySelector(':scope > .ytContentMetadataViewModelDelimiter') && !r.querySelector(':scope > .ytContentMetadataViewModelLeadingIcon') && r.querySelector(':scope > .ytContentMetadataViewModelMetadataText'));
    const channel = channelRow?.querySelector(':scope > .ytContentMetadataViewModelMetadataText');
    if (channel && !card.querySelector('badge-shape.ytBadgeShapeThumbnailLive')) n.channel += shown(channel) ? 1 : 0;
    n.views += [...card.querySelectorAll('.ytContentMetadataViewModelLeadingIcon + .ytContentMetadataViewModelMetadataText')].filter(shown).length;
    n.dates += [...card.querySelectorAll('.ytContentMetadataViewModelDelimiter + .ytContentMetadataViewModelMetadataText')].filter(shown).length;
  }
  for (const meta of document.querySelectorAll('ytd-video-meta-block')) {
    if (meta.closest('[hidden]')) continue;
    n.cards++;
    const spans = meta.querySelectorAll('#metadata-line > span.inline-metadata-item');
    if (spans[0] && shown(spans[0])) n.views++;
    if (spans[1] && shown(spans[1])) n.dates++;
    const name = meta.querySelector('ytd-channel-name');
    if (name && shown(name)) n.channel++;
  }
  for (const sub of document.querySelectorAll('.shortsLockupViewModelHostOutsideMetadataSubhead')) {
    n.cards++;
    if (shown(sub)) n.views++;
  }
  return n;
}

const SURFACES = [
  ['channel Home shelves', '/@MrBeast/featured?fixture=channel-home', 'channel-home'],
  ['channel Videos tab', '/@MrBeast/videos', 'channel-videos'],
  ['watch sidebar', '/watch?v=n61ULEU7CO0', 'watch-chapters'],
  ['live watch sidebar', '/watch?v=n61ULEU7CO0&fixture=watch-live', 'watch-live'],
  ['playlist page', '/playlist?list=PLx', 'playlist'],
  ['search results (legacy cards)', '/results?search_query=lofi', 'search-lofi'],
  ['search with a Shorts shelf', '/results?search_query=rice&fixture=search-rice', 'search-rice'],
  ['hashtag page (legacy grid cards)', '/hashtag/cooking', 'hashtag'],
];

describe('card metadata on every surface of the snapshots', { skip: fixturesAvailable(SURFACES.map((s) => s[2])) ? false : 'some research snapshots are not on this machine' }, () => {
  let page;
  before(async () => {
    await launch();
    await mkdir(SHOTS, { recursive: true });
    await installYouTubeFixtures(getContext());
    page = trackErrors(await getContext().newPage());
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  after(async () => close());

  async function apply(settings) {
    await setStorage({ settings });
    const want = Object.keys(settings);
    await page.waitForFunction((ids) => {
      const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ');
      return ids.every((id) => tokens.includes(id)) && ['yt.general.hideViewCounts', 'yt.general.hideUploadDates'].filter((id) => !ids.includes(id)).every((id) => !tokens.includes(id));
    }, want, { timeout: 10_000 });
    await sleep(150);
  }

  for (const [label, url, snapshot] of SURFACES) {
    test(label, async () => {
      await setStorage({ settings: {} });
      await page.goto(`https://www.youtube.com${url}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.hasAttribute('data-at-peace'), null, { timeout: 15_000 });
      await sleep(300);
      const base = await page.evaluate(surfaceReportInPage);
      assert.ok(base.cards > 0, `${snapshot}: cards found`);
      assert.ok(base.views > 0, `${snapshot}: there are view counts to hide`);

      await apply({ [VIEWS]: true });
      const views = await page.evaluate(surfaceReportInPage);
      assert.equal(views.views, 0, `${snapshot}: view counts gone`);
      assert.equal(views.channel, base.channel, `${snapshot}: channel names stay`);
      assert.equal(views.dates, base.dates, `${snapshot}: dates stay`);
      await page.screenshot({ path: join(SHOTS, `surface-${snapshot}-views.png`) });

      await apply({ [DATES]: true });
      const dates = await page.evaluate(surfaceReportInPage);
      assert.equal(dates.dates, 0, `${snapshot}: dates gone`);
      assert.equal(dates.channel, base.channel, `${snapshot}: channel names stay`);
      assert.equal(dates.views, base.views, `${snapshot}: view counts stay`);

      await apply({ [VIEWS]: true, [DATES]: true });
      const both = await page.evaluate(surfaceReportInPage);
      assert.deepEqual([both.views, both.dates, both.channel], [0, 0, base.channel], `${snapshot}: only the channel is left`);
      await apply({});
    });
  }
});
