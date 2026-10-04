// The DNR rules compiler (src/background/rules.js): computeRules is pure, syncRules applies a diff.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { bgWorld } from './_bg.mjs';

let w;
let AP;
let R; // AP.bg.rules

const NOW = new Date(2026, 5, 10, 12, 0).getTime(); // Wednesday
const MIN = 60_000;
const PAUSE_URL = 'moz-extension://uuid/src/pages/pause/pause.html';
const BLOCKED_URL = 'moz-extension://uuid/src/pages/blocked/blocked.html';

beforeEach(async () => {
  w = await bgWorld({ now: NOW });
  ({ AP } = w);
  R = AP.bg.rules;
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const YT = { siteKey: 'youtube', domain: 'youtube.com', enabled: true };
const settingsOf = (extra = {}) => AP.settings.merge({ 'pause.enabled': true, ...extra });
const stateOf = (extra = {}) => ({ sessions: {}, blocks: [], block: null, extraTime: {}, sessionMinutes: {}, scheduleOverride: null, ...extra });
const compute = (settings, state = stateOf(), options = {}) => R.computeRules(settings, state, NOW, { pauseUrl: PAUSE_URL, blockedUrl: BLOCKED_URL, ...options });
const ids = (rules) => rules.map((r) => r.id);

describe('computeRules', () => {
  test('nothing configured: no rules', () => {
    assert.deepEqual(compute(settingsOf({ 'pause.enabled': false })), []);
  });

  test('pause on, no session: one pause rule for YouTube, redirecting with the original URL in the hash', () => {
    const rules = compute(settingsOf());
    assert.deepEqual(rules, [
      {
        id: 200,
        priority: 200,
        action: { type: 'redirect', redirect: { regexSubstitution: `${PAUSE_URL}#\\0` } },
        condition: { regexFilter: '^https?://(www\\.|m\\.)?youtube\\.com/.*', isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
      },
    ]);
  });

  test('an active session removes the pause rule; an expired one does not', () => {
    assert.deepEqual(compute(settingsOf(), stateOf({ sessions: { youtube: NOW + MIN } })), []);
    assert.deepEqual(ids(compute(settingsOf(), stateOf({ sessions: { youtube: NOW } }))), [200]);
    assert.deepEqual(ids(compute(settingsOf(), stateOf({ sessions: { youtube: NOW - 1 } }))), [200]);
  });

  test('a session of another site does not unpause YouTube', () => {
    assert.deepEqual(ids(compute(settingsOf(), stateOf({ sessions: { 'reddit.com': NOW + MIN } }))), [200]);
  });

  test('pause disabled globally or for the site: no pause rule', () => {
    assert.deepEqual(compute(settingsOf({ 'pause.enabled': false })), []);
    assert.deepEqual(compute(settingsOf({ 'pause.sites': [{ ...YT, enabled: false }] })), []);
    assert.deepEqual(compute(settingsOf({ 'pause.sites': [] })), [], 'YouTube removed from the list: no pause');
  });

  test('block rules: priority 300, ids from 100, blocked page with the reason and the URL in the hash', () => {
    const state = stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['youtube'] }] });
    const [block] = compute(settingsOf({ 'pause.enabled': false }), state);
    assert.deepEqual(block, {
      id: 100,
      priority: 300,
      action: { type: 'redirect', redirect: { regexSubstitution: `${BLOCKED_URL}?reason=focus#\\0` } },
      condition: { regexFilter: '^https?://(www\\.|m\\.)?youtube\\.com/.*', isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
    });
  });

  test('a block outranks the pause: both are present, the block has the higher priority', () => {
    const state = stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['youtube'] }] });
    const rules = compute(settingsOf(), state);
    assert.deepEqual(ids(rules), [100, 200]);
    assert.ok(rules[0].priority > rules[1].priority);
    // Pause stays computed even while blocked, so it is back the instant the block ends.
  });

  test('an expired block is ignored', () => {
    assert.deepEqual(compute(settingsOf({ 'pause.enabled': false }), stateOf({ blocks: [{ reason: 'focus', until: NOW, siteKeys: ['youtube'] }] })), []);
  });

  test('a limit block uses reason=limit', () => {
    const rules = compute(settingsOf({ 'pause.enabled': false }), stateOf({ blocks: [{ reason: 'limit', until: NOW + MIN, siteKeys: ['youtube'] }] }));
    assert.match(rules[0].action.redirect.regexSubstitution, /\?reason=limit#\\0$/);
  });

  test('a schedule block that is active on the clock closes the site even when state.blocks is empty', () => {
    const schedule = { id: 's', name: 'Work', days: [3], start: '09:00', end: '17:00', action: 'block', siteKeys: ['youtube'], enabled: true };
    const rules = compute(settingsOf({ 'pause.enabled': false, 'focus.schedules': [schedule] }));
    assert.equal(rules.length, 1);
    assert.match(rules[0].action.redirect.regexSubstitution, /\?reason=schedule#/);
    const off = compute(settingsOf({ 'pause.enabled': false, 'focus.schedules': [{ ...schedule, days: [4] }] }));
    assert.deepEqual(off, []);
    const preset = compute(settingsOf({ 'pause.enabled': false, 'focus.schedules': [{ ...schedule, action: 'preset:focused' }] }));
    assert.deepEqual(preset, [], 'a preset schedule is not a block');
  });

  test('several blocks on one site: one rule, the strongest reason', () => {
    const state = stateOf({
      blocks: [
        { reason: 'schedule', until: NOW + 9 * MIN, siteKeys: ['youtube'] },
        { reason: 'limit', until: NOW + 5 * MIN, siteKeys: ['youtube'] },
        { reason: 'focus', until: NOW + MIN, siteKeys: ['youtube'] },
      ],
    });
    const rules = compute(settingsOf({ 'pause.enabled': false }), state);
    assert.equal(rules.length, 1);
    assert.match(rules[0].action.redirect.regexSubstitution, /reason=focus/);
  });

  describe('user sites', () => {
    const REDDIT = { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true };
    const withSites = (...sites) => settingsOf({ 'pause.sites': [YT, ...sites] });

    test('a user domain gets its own pause rule with an RE2-safe, escaped regex', () => {
      const rules = compute(withSites(REDDIT, { siteKey: 'news.example.co.uk', domain: 'news.example.co.uk', enabled: true }));
      assert.deepEqual(ids(rules), [200, 201, 202]);
      // ids follow the sorted site keys: news…, reddit.com, youtube
      assert.equal(rules[0].condition.regexFilter, '^https?://([a-z0-9-]+\\.)*news\\.example\\.co\\.uk/.*');
      assert.equal(rules[1].condition.regexFilter, '^https?://([a-z0-9-]+\\.)*reddit\\.com/.*');
      assert.equal(rules[2].condition.regexFilter, R.YOUTUBE_REGEX);
      for (const r of rules) assert.doesNotMatch(r.condition.regexFilter, /\(\?[=!<]|\\[1-9]/);
    });

    test('the regex matches the domain and its subdomains, but not look-alikes', () => {
      const re = new RegExp(R.siteRegex(REDDIT), 'i');
      for (const url of ['https://reddit.com/', 'http://www.reddit.com/r/x?y=1', 'https://old.reddit.com/', 'https://a.b.reddit.com/z']) assert.ok(re.test(url), url);
      for (const url of ['https://notreddit.com/', 'https://reddit.com.evil.example/', 'https://evil.example/reddit.com/', 'https://redditXcom/']) assert.ok(!re.test(url), url);
      assert.equal(new RegExp(R.siteRegex(REDDIT), 'i').exec('https://www.reddit.com/r/x?y=1#f')[0], 'https://www.reddit.com/r/x?y=1#f', '\\0 is the whole URL');
    });

    test('YouTube regex: bare, www and m — not music, studio or look-alikes', () => {
      const re = new RegExp(R.YOUTUBE_REGEX, 'i');
      for (const url of ['https://youtube.com/', 'https://www.youtube.com/watch?v=abc', 'http://m.youtube.com/', 'https://www.youtube.com/']) assert.ok(re.test(url), url);
      for (const url of ['https://music.youtube.com/', 'https://studio.youtube.com/', 'https://notyoutube.com/', 'https://youtube.com.evil.example/', 'https://www.youtube.com.evil.example/']) assert.ok(!re.test(url), url);
    });

    test('a domain with regex metacharacters cannot widen the rule', () => {
      assert.equal(R.escapeRegex('a.b+c(d)'), 'a\\.b\\+c\\(d\\)');
      const odd = { siteKey: 'a.b', domain: 'a.b', enabled: true };
      assert.ok(!new RegExp(R.siteRegex(odd)).test('https://axb/'));
    });

    test('a site with a running session or switched off is left out; a block still covers a site that is not listed', () => {
      const rules = compute(withSites(REDDIT, { siteKey: 'x.org', domain: 'x.org', enabled: false }), stateOf({ sessions: { 'reddit.com': NOW + MIN } }));
      assert.deepEqual(ids(rules), [200], 'only YouTube is paused');
      const blocked = compute(settingsOf({ 'pause.enabled': false }), stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['unlisted.com'] }] }));
      assert.deepEqual(blocked, [], 'a site without a known domain cannot be matched');
    });

    test('focus block for a user site: block rule with that site\'s regex', () => {
      const rules = compute(withSites(REDDIT), stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['reddit.com'] }] }));
      const block = rules.find((r) => r.id < 200);
      assert.equal(block.condition.regexFilter, '^https?://([a-z0-9-]+\\.)*reddit\\.com/.*');
    });
  });

  describe('YouTube redirects (Contract C2)', () => {
    const redirects = (list) => ({ dnrRules: (settings, { blockedPageUrl }) => (typeof list === 'function' ? list(settings, blockedPageUrl) : list) });
    const home = { key: 'home', action: { type: 'redirect', redirect: { url: 'https://www.youtube.com/feed/subscriptions' } }, condition: { regexFilter: '^https://www\\.youtube\\.com/$' } };
    const shorts = { key: 'shorts', action: { type: 'redirect', redirect: { regexSubstitution: 'https://www.youtube.com/watch?v=\\1' } }, condition: { regexFilter: '^https://www\\.youtube\\.com/shorts/([^/?#]+)' }, priority: 120 };

    test('merged after the others: ids from 300 in sorted key order, default priority 100, main_frame only', () => {
      const rules = compute(settingsOf(), stateOf(), { ytRedirects: redirects([shorts, home]) });
      assert.deepEqual(ids(rules), [200, 300, 301]);
      assert.equal(rules[1].action.redirect.url, 'https://www.youtube.com/feed/subscriptions', 'key "home" sorts before "shorts"');
      assert.equal(rules[1].priority, 100);
      assert.equal(rules[2].priority, 120);
      assert.deepEqual(rules[1].condition.resourceTypes, ['main_frame']);
    });

    test('the catalog gets the effective settings and the blocked page URL', () => {
      let seen;
      compute(settingsOf({ 'yt.shorts.mode': 'block' }), stateOf(), { ytRedirects: redirects((settings, blockedPageUrl) => ((seen = { mode: settings['yt.shorts.mode'], blockedPageUrl }), [])) });
      assert.deepEqual(seen, { mode: 'block', blockedPageUrl: BLOCKED_URL });
    });

    test('ids stay in their ranges: block < 200 < pause < 300 <= redirects < 400, priorities strictly ordered', () => {
      const many = Array.from({ length: 5 }, (_, i) => ({ ...home, key: `k${i}` }));
      const sites = Array.from({ length: 4 }, (_, i) => ({ siteKey: `s${i}.com`, domain: `s${i}.com`, enabled: true }));
      const rules = compute(settingsOf({ 'pause.sites': [YT, ...sites] }), stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['youtube', 's0.com', 's3.com'] }] }), { ytRedirects: redirects(many) });
      const blockRules = rules.filter((r) => r.priority === 300);
      const pauseRules = rules.filter((r) => r.priority === 200);
      const redirectRules = rules.filter((r) => r.priority === 100);
      assert.deepEqual([blockRules.length, pauseRules.length, redirectRules.length], [3, 5, 5]);
      for (const r of blockRules) assert.ok(r.id >= 100 && r.id < 200);
      for (const r of pauseRules) assert.ok(r.id >= 200 && r.id < 300);
      for (const r of redirectRules) assert.ok(r.id >= 300 && r.id < 400);
      assert.equal(new Set(ids(rules)).size, rules.length, 'unique ids');
    });

    test('ids are stable: the same inputs give the same rules; unrelated changes do not renumber', () => {
      const a = compute(settingsOf(), stateOf(), { ytRedirects: redirects([home, shorts]) });
      const b = compute(settingsOf(), stateOf(), { ytRedirects: redirects([shorts, home]) });
      assert.deepEqual(a, b);
      const withBlock = compute(settingsOf(), stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['youtube'] }] }), { ytRedirects: redirects([home, shorts]) });
      assert.deepEqual(withBlock.filter((r) => r.id >= 300), a.filter((r) => r.id >= 300));
    });

    test('the master switch governs redirects, but not the pause or the blocks', () => {
      const off = settingsOf({ 'general.enabled': false });
      const rules = compute(off, stateOf({ blocks: [{ reason: 'focus', until: NOW + MIN, siteKeys: ['youtube'] }] }), { ytRedirects: redirects([home]) });
      assert.deepEqual(ids(rules), [100, 200]);
    });

    test('a catalog that throws or returns junk never breaks the other rules', () => {
      const boom = redirects(() => {
        throw new Error('bad catalog');
      });
      assert.deepEqual(ids(compute(settingsOf(), stateOf(), { ytRedirects: boom })), [200]);
      assert.deepEqual(ids(compute(settingsOf(), stateOf(), { ytRedirects: redirects('nope') })), [200]);
      assert.deepEqual(ids(compute(settingsOf(), stateOf(), { ytRedirects: redirects([null, { key: 5 }, { key: 'x' }, home]) })), [200, 300]);
      assert.deepEqual(ids(compute(settingsOf(), stateOf(), {})), [200], 'no catalog loaded (yet)');
    });
  });
});

describe('diffRules', () => {
  const rule = (id, extra = {}) => ({ id, priority: 100, action: { type: 'redirect', redirect: { url: 'https://a/' } }, condition: { regexFilter: 'x', resourceTypes: ['main_frame'] }, ...extra });

  test('adds what is missing, removes what is gone, replaces what changed, ignores extra fields the browser reports', () => {
    const existing = [rule(100), rule(101), rule(102, { condition: { regexFilter: 'x', resourceTypes: ['main_frame'], isUrlFilterCaseSensitive: false } }), rule(999)];
    const desired = [rule(100), rule(102), rule(103), rule(101, { priority: 5 })];
    const { removeRuleIds, addRules } = R.diffRules(desired, existing);
    assert.deepEqual(removeRuleIds, [101], 'rule 999 is outside our ranges and is left alone');
    assert.deepEqual(addRules.map((r) => r.id).sort(), [101, 103]);
  });

  test('identical lists need no update', () => {
    const list = [rule(100), rule(300)];
    assert.deepEqual(R.diffRules(list, structuredClone(list)), { removeRuleIds: [], addRules: [] });
  });
});

describe('syncRules', () => {
  test('applies the diff in one updateDynamicRules call, and is a no-op the second time', async () => {
    await w.settings({ 'pause.enabled': true });
    assert.deepEqual(await R.syncRules(), { added: 1, removed: 0 });
    assert.equal(w.fake.declarativeNetRequest.calls.length, 1);
    assert.deepEqual(await R.syncRules(), { added: 0, removed: 0 });
    assert.equal(w.fake.declarativeNetRequest.calls.length, 1);
    await w.settings({ 'pause.enabled': false });
    assert.deepEqual(await R.syncRules(), { added: 0, removed: 1 });
  });

  test('uses the extension\'s own page URLs', async () => {
    await w.settings({ 'pause.enabled': true });
    await R.syncRules();
    assert.equal((await w.rules())[0].action.redirect.regexSubstitution, 'moz-extension://fake-uuid/src/pages/pause/pause.html#\\0');
  });

  test('the browser\'s regex engine accepts every rule we generate (RE2 refusals are simulated)', async () => {
    await w.settings({ 'pause.enabled': true, 'pause.sites': [YT, { siteKey: 'a-b.example.org', domain: 'a-b.example.org', enabled: true }] });
    await fake().storage.local.set({ state: { block: { until: NOW + 5 * MIN, reason: 'focus', siteKeys: ['youtube', 'a-b.example.org'] } } });
    await AP.bg.sessions.reconcile();
    assert.equal((await w.rules()).length, 4);
  });

  test('a refused redirect rule is skipped and never takes the pause and block rules down', async () => {
    AP.yt = { redirects: { dnrRules: () => [{ key: 'bad', action: { type: 'redirect', redirect: { url: 'https://x/' } }, condition: { regexFilter: '^(?=lookahead)' } }, { key: 'good', action: { type: 'redirect', redirect: { url: 'https://y/' } }, condition: { regexFilter: '^https://www\\.youtube\\.com/$' } }] } };
    await w.settings({ 'pause.enabled': true });
    const result = await R.syncRules();
    assert.deepEqual(result.skipped, [300]);
    assert.deepEqual((await w.rules()).map((r) => r.id), [200, 301]);
    assert.ok(console.warn.mock.callCount() >= 1);
  });

  test('works without the DNR API (e.g. a browser that lacks it)', async () => {
    delete w.fake.declarativeNetRequest;
    assert.deepEqual(await R.syncRules(), { added: 0, removed: 0 });
  });
});

function fake() {
  return globalThis.browser;
}
