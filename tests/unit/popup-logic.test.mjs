// The pure half of the popup (src/pages/common/logic.js): which sections matter on which page,
// which settings are edited in the row, how the All tab's search narrows things, and when "Update
// <preset>" is offered. Runs against the real shipped catalog.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

let AP;
let ui;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, 'src/sites/youtube/page.js']);
  await import(new URL(`../../src/pages/common/logic.js?t=${Math.random()}`, import.meta.url).href);
  ui = AP.ui;
});

afterEach(() => uninstallFakeBrowser());

const ids = (list) => list.map((s) => s.id);

describe('youTubeTab: is the active tab on YouTube, and which page is it?', () => {
  test('YouTube addresses give their page type', () => {
    for (const [url, page] of [
      ['https://www.youtube.com/', 'home'],
      ['https://www.youtube.com/watch?v=abc', 'watch'],
      ['https://www.youtube.com/results?search_query=lofi', 'search'],
      ['https://www.youtube.com/shorts/xyz', 'shorts'],
      ['https://www.youtube.com/@someone/videos', 'channel'],
      ['https://www.youtube.com/feed/subscriptions', 'subscriptions'],
      ['https://www.youtube.com/playlist?list=PL1', 'playlist'],
      ['https://www.youtube.com/feed/trending', 'other'],
      ['https://m.youtube.com/watch?v=abc', 'watch'],
    ]) {
      assert.deepEqual(ui.youTubeTab(url), { onYouTube: true, page }, url);
    }
  });

  test('anything else, or no address at all, is not YouTube', () => {
    for (const url of ['https://example.com/watch?v=abc', 'https://music.youtube.com/', 'https://notyoutube.com/', 'about:blank', 'moz-extension://x/popup.html', undefined, null, '', 42]) {
      assert.deepEqual(ui.youTubeTab(url), { onYouTube: false, page: null }, String(url));
    }
  });
});

describe('pageSections: the sections "This page" shows', () => {
  test('a watch page: the video page first, then player, comments and all of YouTube', () => {
    assert.deepEqual(ids(ui.pageSections('watch')), ['yt.watch', 'yt.player', 'yt.comments', 'yt.general']);
  });

  test('home, search, Shorts, channel and subscriptions each lead with their own section', () => {
    assert.deepEqual(ids(ui.pageSections('home')), ['yt.home', 'yt.general', 'yt.masthead', 'yt.guide']);
    assert.deepEqual(ids(ui.pageSections('search')), ['yt.search', 'yt.general', 'yt.masthead']);
    assert.deepEqual(ids(ui.pageSections('shorts')), ['yt.shorts', 'yt.comments']);
    assert.equal(ui.pageSections('channel')[0].id, 'yt.channel');
    assert.equal(ui.pageSections('subscriptions')[0].id, 'yt.subs');
  });

  test('every other page, and an unknown one: all of YouTube, top bar, left sidebar', () => {
    for (const page of ['playlist', 'history', 'you', 'hashtag', 'other', 'nonsense', null, undefined]) {
      assert.deepEqual(ids(ui.pageSections(page)), ['yt.general', 'yt.masthead', 'yt.guide'], String(page));
    }
  });

  test('every section it names exists in the registry and has settings (a renamed section would silently vanish)', () => {
    const types = AP.yt.page.TYPES;
    for (const page of [...types, 'nonsense']) {
      for (const section of ui.pageSections(page)) assert.ok(AP.schema.bySection(section.id).length > 0, `${page}: ${section.id}`);
    }
    // the section names resolve for the page types the popup special-cases
    for (const page of ['watch', 'home', 'search', 'shorts', 'channel', 'subscriptions']) assert.ok(ui.pageSections(page).length >= 2, page);
  });

  test('sections the registry lacks are skipped, the order of the list is kept', () => {
    const partial = [{ id: 'yt.comments' }, { id: 'yt.watch' }];
    assert.deepEqual(ids(ui.pageSections('watch', partial)), ['yt.watch', 'yt.comments']);
    assert.deepEqual(ui.pageSections('home', []), []);
  });
});

describe('isInlineSetting: a switch, a choice or a number is edited in the row; the rest opens the settings page', () => {
  test('by type', () => {
    for (const type of ['toggle', 'select', 'number']) assert.equal(ui.isInlineSetting({ type }), true, type);
    for (const type of ['list', 'object', 'text', 'textarea']) assert.equal(ui.isInlineSetting({ type }), false, type);
  });

  test('in the shipped catalog: lists, objects and text are "Edit" rows, the filters and the lock among them', () => {
    const edit = AP.schema.all().filter((d) => !ui.isInlineSetting(d)).map((d) => d.id);
    for (const id of ['yt.filters.keywords', 'yt.filters.channels', 'yt.filters.applyTo', 'pause.sites', 'focus.schedules', 'advanced.customRules', 'advanced.lock']) {
      assert.ok(edit.includes(id), id);
    }
    for (const id of ['general.theme', 'pause.enabled', 'pause.breathSeconds', 'pause.sessionMinutes', 'focus.dailyMinutes', 'yt.home.feedMode']) {
      assert.ok(ui.isInlineSetting(AP.schema.get(id)), id);
    }
  });
});

describe('search in the All tab', () => {
  const grayscale = { id: 'yt.general.grayscale', label: 'Show YouTube in grayscale', group: 'Look' };
  const views = { id: 'yt.general.hideViewCounts', label: 'Hide view counts', group: 'On video cards' };
  const dates = { id: 'yt.general.hideUploadDates', label: 'Hide upload dates', group: 'On video cards', advanced: true };
  const comments = { id: 'yt.comments.hideAll', label: 'Hide comments', group: 'Comments' };
  const general = { id: 'yt.general', title: 'All of YouTube' };
  const commentsSection = { id: 'yt.comments', title: 'Comments' };

  test('every word has to appear in the label, the group or the section title; case and accents do not matter', () => {
    assert.equal(ui.popupMatches(views, 'view counts', general), true);
    assert.equal(ui.popupMatches(views, 'VIEW', general), true);
    assert.equal(ui.popupMatches(views, 'view dates', general), false, 'both words must match the same setting');
    assert.equal(ui.popupMatches(views, 'video cards', general), true, 'the group name counts');
    assert.equal(ui.popupMatches(views, 'all of youtube', general), true, 'so does the section title');
    assert.equal(ui.popupMatches(views, 'grayscale', general), false);
    assert.equal(ui.popupMatches({ label: 'Épisodes' }, 'episodes', null), true);
    assert.equal(ui.popupMatches(views, '', general), true, 'an empty search matches everything');
    assert.equal(ui.popupMatches(views, '   ', general), true);
  });

  test('ids, tags and descriptions are not searched (what you see is what you find)', () => {
    assert.equal(ui.popupMatches({ id: 'yt.general.hideViewCounts', label: 'Metrics', tags: ['metrics'], description: 'secret words' }, 'secret', null), false);
    assert.equal(ui.popupMatches({ id: 'yt.general.hideViewCounts', label: 'Metrics' }, 'hideViewCounts', null), false);
  });

  test('filterPopupGroups narrows each section to its matches and drops sections with none', () => {
    const groups = [
      { section: general, defs: [grayscale, views, dates] },
      { section: commentsSection, defs: [comments] },
    ];
    const hits = ui.filterPopupGroups(groups, 'hide');
    assert.deepEqual(hits.map((g) => [g.section.id, g.defs.map((d) => d.id)]), [
      ['yt.general', ['yt.general.hideViewCounts', 'yt.general.hideUploadDates']],
      ['yt.comments', ['yt.comments.hideAll']],
    ]);
    assert.deepEqual(ui.filterPopupGroups(groups, 'comments').map((g) => g.section.id), ['yt.comments'], 'a section title finds its settings');
    assert.deepEqual(ui.filterPopupGroups(groups, 'zebra'), []);
  });

  test('without a search advanced settings stay hidden until "Show advanced"; a search finds them anyway', () => {
    const groups = [{ section: general, defs: [grayscale, views, dates] }];
    assert.deepEqual(ui.filterPopupGroups(groups, '')[0].defs.map((d) => d.id), ['yt.general.grayscale', 'yt.general.hideViewCounts']);
    assert.equal(ui.filterPopupGroups(groups, '', { showAdvanced: true })[0].defs.length, 3);
    assert.deepEqual(ui.filterPopupGroups(groups, 'upload')[0].defs.map((d) => d.id), ['yt.general.hideUploadDates']);
  });

  test('a section made only of advanced settings disappears while they are hidden', () => {
    assert.deepEqual(ui.filterPopupGroups([{ section: general, defs: [dates] }], ''), []);
  });

  test('on the real catalog a search for "comment" reaches the comments section', () => {
    const groups = AP.schema
      .sections({ site: 'youtube' })
      .filter((s) => s.site === 'youtube')
      .map((section) => ({ section, defs: AP.schema.bySection(section.id) }));
    const hits = ui.filterPopupGroups(groups, 'comment');
    assert.ok(hits.some((g) => g.section.id === 'yt.comments'));
    for (const g of hits) for (const d of g.defs) assert.ok(ui.popupMatches(d, 'comment', g.section));
  });
});

describe('clusterGroups', () => {
  test('groups by name in order of first appearance; a setting without a group is nameless', () => {
    const defs = [{ id: 'a', group: 'X' }, { id: 'b' }, { id: 'c', group: 'X' }, { id: 'd', group: 'Y' }];
    assert.deepEqual(
      ui.clusterGroups(defs).map((g) => [g.name, g.defs.map((d) => d.id)]),
      [['X', ['a', 'c']], ['', ['b']], ['Y', ['d']]],
    );
  });
});

describe('presetToUpdate: "Update <name>" is offered only for a custom preset that the settings have drifted from', () => {
  const builtIn = () => AP.presets.builtIn();
  const mine = { id: 'preset_mine', name: 'Mine', builtIn: false, values: { 'yt.general.grayscale': true } };
  const base = () => AP.settings.merge({});

  test('offered once the settings match no preset at all', () => {
    const values = { ...base(), 'yt.general.grayscale': true, 'yt.comments.hideAll': true };
    assert.equal(ui.presetToUpdate(values, builtIn(), [mine], 'preset_mine'), mine);
  });

  test('not while the settings still are that preset', () => {
    assert.equal(ui.presetToUpdate({ ...base(), 'yt.general.grayscale': true }, builtIn(), [mine], 'preset_mine'), null);
  });

  test('not when the settings now match another preset (the menu shows that one)', () => {
    assert.equal(ui.presetToUpdate(base(), builtIn(), [mine], 'preset_mine'), null, 'the defaults are Untouched');
  });

  test('not without a remembered preset, or when it was deleted, or when it is a built-in', () => {
    const drifted = { ...base(), 'yt.general.grayscale': true, 'yt.comments.hideAll': true };
    assert.equal(ui.presetToUpdate(drifted, builtIn(), [mine], null), null);
    assert.equal(ui.presetToUpdate(drifted, builtIn(), [mine], 'preset_gone'), null);
    assert.equal(ui.presetToUpdate(drifted, builtIn(), [mine], 'gentle'), null);
    assert.equal(ui.presetToUpdate(drifted, builtIn(), [], 'preset_mine'), null);
  });
});
