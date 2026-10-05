// Registry, validation and CSS compiler (src/shared/schema-core.js) on a throw-away registry.
// The shipped schema is covered by schema-shipped.test.mjs.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let AP;
let S;

beforeEach(async () => {
  AP = await loadAtPeace([...CORE_SCRIPTS, 'src/shared/schema-core.js']);
  S = AP.schema;
  S.section({ id: 'general', site: null, title: 'General', order: 10 });
  S.section({ id: 'yt.home', site: 'youtube', title: 'Home', order: 130 });
  S.section({ id: 'yt.watch', site: 'youtube', title: 'Watch', order: 110 });
  S.section({ id: 'pause', title: 'Pause', order: 900 });
});

afterEach(() => uninstallFakeBrowser());

const toggle = (id, extra = {}) => ({ id, label: id, type: 'toggle', default: false, ...extra });
const selectDef = (id, extra = {}) => ({
  id,
  label: id,
  type: 'select',
  default: 'show',
  options: [
    { value: 'show', label: 'Show' },
    { value: 'blur', label: 'Blur' },
    { value: 'hide', label: 'Hide' },
  ],
  ...extra,
});

describe('registry', () => {
  test('sections sort by order and filter by site', () => {
    assert.deepEqual(S.sections().map((s) => s.id), ['general', 'yt.watch', 'yt.home', 'pause']);
    assert.deepEqual(S.sections({ site: 'youtube' }).map((s) => s.id), ['general', 'yt.watch', 'yt.home', 'pause']);
    assert.deepEqual(S.sections({ site: null }).map((s) => s.id), ['general', 'pause']);
    assert.deepEqual(S.sections({ site: 'instagram' }).map((s) => s.id), ['general', 'pause']);
    assert.equal(S.sections()[3].site, null, 'a missing site means cross-site');
  });

  test('equal order keeps registration order', () => {
    S.section({ id: 'a', title: 'A', order: 50 });
    S.section({ id: 'b', title: 'B', order: 50 });
    assert.deepEqual(S.sections().filter((s) => s.order === 50).map((s) => s.id), ['a', 'b']);
  });

  test('define stamps the section, keeps order, and get/bySection/byTag work', () => {
    S.define('yt.home', [toggle('yt.home.a', { tags: ['ads'], hide: ['x'] }), toggle('yt.home.b', { tags: ['ads', 'shorts'], hide: ['y'] })]);
    S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' })]);
    assert.deepEqual(S.all().map((d) => d.id), ['yt.home.a', 'yt.home.b', 'general.enabled']);
    assert.equal(S.get('yt.home.a').section, 'yt.home');
    assert.equal(S.get('nope'), undefined);
    assert.equal(S.get(undefined), undefined);
    assert.deepEqual(S.bySection('yt.home').map((d) => d.id), ['yt.home.a', 'yt.home.b']);
    assert.deepEqual(S.byTag('ads').map((d) => d.id), ['yt.home.a', 'yt.home.b']);
    assert.deepEqual(S.byTag('shorts').map((d) => d.id), ['yt.home.b']);
    assert.deepEqual(S.byTag('ai'), []);
  });

  test('definitions are frozen and all() hands out a copy', () => {
    S.define('yt.home', [toggle('yt.home.a', { hide: ['x'] })]);
    assert.throws(() => {
      S.get('yt.home.a').default = true;
    }, TypeError);
    S.all().pop();
    assert.equal(S.all().length, 1);
  });

  test('siteOf: known site prefix → site, anything else → cross-site', () => {
    assert.equal(S.siteOf('yt.home.hideChips'), 'youtube');
    assert.equal(S.siteOf('pause.enabled'), null);
    assert.equal(S.siteOf('general.enabled'), null);
    assert.equal(S.siteOf('ytx.home.a'), null);
    assert.equal(S.siteOf('yt'), null);
    assert.equal(S.siteOf('constructor.x'), null, 'prototype keys are not site prefixes');
    assert.equal(S.siteOf(42), null);
  });

  test('defaults() returns a fresh copy, so mutating it cannot corrupt the registry', () => {
    S.define('pause', [
      { id: 'pause.sites', label: 'Sites', type: 'list', default: [], item: (x) => x },
      { id: 'pause.obj', label: 'Obj', type: 'object', default: { mode: 'none' } },
    ]);
    const a = S.defaults();
    a['pause.sites'].push('x');
    a['pause.obj'].mode = 'changed';
    const b = S.defaults();
    assert.deepEqual(b['pause.sites'], []);
    assert.deepEqual(b['pause.obj'], { mode: 'none' });
  });

  test('registration never throws on garbage, and validateRegistry reports it', () => {
    S.section(null);
    S.section({ title: 'no id' });
    S.section({ id: 'general', title: 'dup', order: 1 });
    S.define('general', 'not an array');
    S.define('general', [null, 5, {}, toggle('general.x', { feature: 'f' }), toggle('general.x', { feature: 'f' })]);
    const problems = S.validateRegistry();
    assert.ok(problems.some((p) => /without an id/.test(p)));
    assert.ok(problems.some((p) => /registered twice/.test(p)));
    assert.ok(problems.some((p) => /expected an array/.test(p)));
    assert.ok(problems.some((p) => /general\.x: defined twice/.test(p)));
  });
});

describe('validateValue', () => {
  test('toggle accepts only booleans', () => {
    const def = toggle('t.a', { default: true });
    assert.equal(S.validateValue(def, false), false);
    for (const bad of ['true', 1, null, undefined, {}, []]) assert.equal(S.validateValue(def, bad), true, String(bad));
  });

  test('select accepts option values; numbers are stringified; the rest falls back', () => {
    const def = selectDef('s.a', {
      default: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: '1.5', label: '1.5x' },
      ],
    });
    assert.equal(S.validateValue(def, '1.5'), '1.5');
    assert.equal(S.validateValue(def, 1.5), '1.5');
    assert.equal(S.validateValue(def, 'nope'), 'default');
    assert.equal(S.validateValue(def, null), 'default');
    assert.equal(S.validateValue(def, ['1.5']), 'default');
  });

  test('number: clamps, snaps to step, accepts numeric strings, rejects the rest', () => {
    const def = { id: 'n.a', label: 'n', type: 'number', default: 6, min: 3, max: 30, step: 1 };
    assert.equal(S.validateValue(def, 10), 10);
    assert.equal(S.validateValue(def, 1), 3);
    assert.equal(S.validateValue(def, 99), 30);
    assert.equal(S.validateValue(def, 7.4), 7);
    assert.equal(S.validateValue(def, 7.6), 8);
    assert.equal(S.validateValue(def, '12'), 12);
    for (const bad of ['', 'abc', NaN, Infinity, null, undefined, true, [], {}]) assert.equal(S.validateValue(def, bad), 6, String(bad));

    const frac = { id: 'n.b', label: 'n', type: 'number', default: 0.5, min: 0, max: 1, step: 0.1 };
    assert.equal(S.validateValue(frac, 0.30000000000000004), 0.3);
    assert.equal(S.validateValue(frac, 0.74), 0.7);
    const free = { id: 'n.c', label: 'n', type: 'number', default: 0 };
    assert.equal(S.validateValue(free, -12.345), -12.345);
  });

  test('step snaps relative to min', () => {
    const def = { id: 'n.d', label: 'n', type: 'number', default: 5, min: 5, max: 50, step: 5 };
    assert.equal(S.validateValue(def, 12), 10);
    assert.equal(S.validateValue(def, 13), 15);
  });

  test('text/textarea: strings within the length limit', () => {
    const text = { id: 'x.a', label: 'x', type: 'text', default: '', maxLength: 5 };
    assert.equal(S.validateValue(text, 'hello'), 'hello');
    assert.equal(S.validateValue(text, 'hello!'), '');
    assert.equal(S.validateValue(text, 5), '');
    const area = { id: 'x.b', label: 'x', type: 'textarea', default: '' };
    assert.equal(S.validateValue(area, 'a'.repeat(50_000)).length, 50_000);
    assert.equal(S.validateValue(area, 'a'.repeat(50_001)), '');
  });

  test('list: default shape is trimmed, de-duplicated strings', () => {
    const def = { id: 'l.a', label: 'l', type: 'list', default: [] };
    assert.deepEqual(S.validateValue(def, [' a ', 'b', 'a', '', '  ', 5, null, 'b']), ['a', 'b']);
    assert.deepEqual(S.validateValue(def, 'a'), []);
    assert.deepEqual(S.validateValue(def, ['x'.repeat(501)]), []);
  });

  test('list with options is a multi-select; maxItems caps; item() normalizes and may drop', () => {
    const multi = {
      id: 'l.b',
      label: 'l',
      type: 'list',
      default: ['home'],
      options: [
        { value: 'home', label: 'Home' },
        { value: 'search', label: 'Search' },
      ],
    };
    assert.deepEqual(S.validateValue(multi, ['search', 'nope', 'search', 'home']), ['search', 'home']);

    const capped = { id: 'l.c', label: 'l', type: 'list', default: [], maxItems: 2 };
    assert.deepEqual(S.validateValue(capped, ['a', 'b', 'c']), ['a', 'b']);

    const items = {
      id: 'l.d',
      label: 'l',
      type: 'list',
      default: [],
      item: (raw) => (raw && typeof raw.n === 'number' ? { n: raw.n } : null),
    };
    assert.deepEqual(S.validateValue(items, [{ n: 1, junk: 1 }, { n: 'x' }, null, { n: 2 }]), [{ n: 1 }, { n: 2 }]);
  });

  test('object: plain JSON objects only, detached copy, size-limited', () => {
    const def = { id: 'o.a', label: 'o', type: 'object', default: { mode: 'none' } };
    const input = { mode: 'x', nested: { a: [1, 2] } };
    const out = S.validateValue(def, input);
    assert.deepEqual(out, input);
    assert.notEqual(out, input);
    assert.notEqual(out.nested, input.nested);
    for (const bad of [null, [], 'x', 5, new Date(), new Map()]) assert.deepEqual(S.validateValue(def, bad), { mode: 'none' });
    assert.deepEqual(S.validateValue(def, { big: 'x'.repeat(30_000) }), { mode: 'none' });
  });

  test('normalize runs last; undefined or a throw means "use the default"', () => {
    const upper = { id: 'x.c', label: 'x', type: 'text', default: 'A', normalize: (v) => v.toUpperCase() };
    assert.equal(S.validateValue(upper, 'abc'), 'ABC');
    const reject = { id: 'x.d', label: 'x', type: 'text', default: 'ok', normalize: () => undefined };
    assert.equal(S.validateValue(reject, 'abc'), 'ok');
    const boom = { id: 'x.e', label: 'x', type: 'text', default: 'ok', normalize: () => { throw new Error('no'); } };
    assert.equal(S.validateValue(boom, 'abc'), 'ok');
    const itemBoom = { id: 'x.f', label: 'x', type: 'list', default: ['d'], item: () => { throw new Error('no'); } };
    assert.deepEqual(S.validateValue(itemBoom, ['a']), ['d']);
  });

  test('coerce reports ok:false when the input was unusable but ok:true for clamped numbers', () => {
    const def = { id: 'n.a', label: 'n', type: 'number', default: 6, min: 3, max: 30 };
    assert.deepEqual(S.coerce(def, 100), { ok: true, value: 30 });
    assert.deepEqual(S.coerce(def, 'x'), { ok: false, value: 6 });
    assert.deepEqual(S.coerce({ id: 'q.a', label: 'q', type: 'weird', default: 1 }, 5), { ok: false, value: 1 });
  });

  test('unknown types and hostile input never throw', () => {
    const def = { id: 'o.b', label: 'o', type: 'object', default: {} };
    const evil = { get a() { throw new Error('getter'); } };
    assert.deepEqual(S.validateValue(def, evil), {});
  });
});

describe('bulk actions', () => {
  beforeEach(() => {
    S.define('yt.home', [
      toggle('yt.home.a', { tags: ['shorts'], hide: ['x'] }),
      toggle('yt.home.b', { tags: ['ai'], hide: ['y'] }),
      selectDef('yt.home.mode', { tags: ['shorts'], variants: { hide: { hide: ['z'] } } }),
      selectDef('yt.home.custom', {
        tags: ['shorts'],
        bulkValue: 'blur',
        variants: { blur: { hide: ['w'] } },
      }),
      { id: 'yt.home.num', label: 'num', type: 'number', default: 0, tags: ['shorts'], feature: 'f' },
    ]);
  });

  test('bulkTargets: toggles → true, selects → bulkValue or the last option, others skipped', () => {
    assert.deepEqual(S.bulkTargets('shorts'), { 'yt.home.a': true, 'yt.home.mode': 'hide', 'yt.home.custom': 'blur' });
    assert.deepEqual(S.bulkTargets('ai'), { 'yt.home.b': true });
    assert.deepEqual(S.bulkTargets('metrics'), {});
  });

  test('isHidingValue', () => {
    const t = S.get('yt.home.a');
    const sel = S.get('yt.home.mode');
    const num = S.get('yt.home.num');
    assert.equal(S.isHidingValue(t, true), true);
    assert.equal(S.isHidingValue(t, false), false);
    assert.equal(S.isHidingValue(t, 'true'), false);
    assert.equal(S.isHidingValue(sel, 'show'), false);
    assert.equal(S.isHidingValue(sel, 'blur'), true);
    assert.equal(S.isHidingValue(num, 0), false);
    assert.equal(S.isHidingValue(num, 3), true);
    assert.equal(S.isHidingValue({ type: 'list' }, []), false);
    assert.equal(S.isHidingValue({ type: 'list' }, ['a']), true);
    assert.equal(S.isHidingValue({ type: 'object' }, { a: 1 }), false);
  });
});

describe('selector hygiene', () => {
  test('isSafeSelector accepts real-world selectors', () => {
    for (const ok of [
      'ytd-masthead #logo',
      'ytd-browse[page-subtype="home"] #chips-wrapper',
      'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
      'a[href*="a;b"]',
      'a[title="{x}"]',
      ".foo\\{bar",
      'ytd-thumbnail > a + span ~ i',
      ':is(a, b) c',
      'a, b',
    ]) assert.equal(S.isSafeSelector(ok), true, ok);
  });

  test('isSafeSelector rejects anything that could break out of the rule', () => {
    for (const bad of [
      '', '   ', undefined, null, 5, {},
      'a { color: red }', 'a } b { c', 'a; b', '@import "x"', 'a /* c */', 'a <b>', 'a\u0000b',
      'a[href="x', 'a[href=x', 'a)', ':is(a', 'a]', 'x'.repeat(1001), 'a"b', "a'b",
    ]) assert.equal(S.isSafeSelector(bad), false, String(bad));
  });

  test('splitSelectorList splits only at top-level commas', () => {
    assert.deepEqual(S.splitSelectorList('a, b ,c'), ['a', 'b', 'c']);
    assert.deepEqual(S.splitSelectorList(':is(a, b) c'), [':is(a, b) c']);
    assert.deepEqual(S.splitSelectorList('a[title="x,y"], b'), ['a[title="x,y"]', 'b']);
    assert.deepEqual(S.splitSelectorList('a   b'), ['a b']);
    assert.deepEqual(S.splitSelectorList('a,,b,'), ['a', 'b']);
  });
});

describe('compileCss', () => {
  const MASTER = 'html[data-at-peace~="general.enabled"] [data-at-peace-filtered] { display: none !important; }';

  test('an empty registry still gets the always-on filter rule, gated by the master token', () => {
    assert.equal(S.compileCss('youtube'), MASTER);
    assert.deepEqual([...S.compileRules('youtube')], [MASTER]);
  });

  test('toggle hide: one rule per selector, gated by the token', () => {
    S.define('yt.home', [toggle('yt.home.hideChips', { hide: ['ytd-browse #chips-wrapper', 'yt-chip-cloud-renderer'] })]);
    assert.deepEqual([...S.compileRules('youtube')], [
      MASTER,
      'html[data-at-peace~="yt.home.hideChips"] ytd-browse #chips-wrapper { display: none !important; }',
      'html[data-at-peace~="yt.home.hideChips"] yt-chip-cloud-renderer { display: none !important; }',
    ]);
  });

  test('page scoping goes on the same html compound and accepts the in-flight navigation target', () => {
    S.define('yt.watch', [toggle('yt.watch.hideRelated', { page: 'watch', hide: ['#related'] })]);
    assert.equal(
      S.compileRules('youtube')[1],
      'html[data-at-peace~="yt.watch.hideRelated"]:is([data-at-peace-page="watch"],[data-at-peace-next="watch"]) #related { display: none !important; }',
    );
  });

  test('rules: every :scope-on becomes the gate; multi-line rules are flattened', () => {
    S.define('yt.home', [
      toggle('yt.home.look', {
        page: 'home',
        rules: [
          ':scope-on ytd-thumbnail img { filter: blur(12px) !important; }',
          ':scope-on a,\n  :scope-on b {\n    color: red;\n  }',
          ':scope-on { filter: grayscale(1) !important; }',
          '@media (min-width: 1px) { :scope-on x { color: red } }',
        ],
      }),
    ]);
    const gate = 'html[data-at-peace~="yt.home.look"]:is([data-at-peace-page="home"],[data-at-peace-next="home"])';
    assert.deepEqual([...S.compileRules('youtube')].slice(1), [
      `${gate} ytd-thumbnail img { filter: blur(12px) !important; }`,
      `${gate} a, ${gate} b { color: red; }`,
      `${gate} { filter: grayscale(1) !important; }`,
      `@media (min-width: 1px) { ${gate} x { color: red } }`,
    ]);
  });

  test('select variants: gated by "id=value" tokens, same page scoping, and nothing for plain values', () => {
    S.define('yt.home', [
      selectDef('yt.home.thumbnails', {
        page: 'home',
        variants: {
          blur: { rules: [':scope-on img { filter: blur(14px) !important; }'] },
          hide: { hide: ['ytd-thumbnail'] },
        },
      }),
    ]);
    const gate = (v) => `html[data-at-peace~="yt.home.thumbnails=${v}"]:is([data-at-peace-page="home"],[data-at-peace-next="home"])`;
    assert.deepEqual([...S.compileRules('youtube')].slice(1), [
      `${gate('blur')} img { filter: blur(14px) !important; }`,
      `${gate('hide')} ytd-thumbnail { display: none !important; }`,
    ]);
  });

  test('selector lists are split into one rule per selector; unsafe selectors and rules are skipped', () => {
    S.define('yt.home', [
      toggle('yt.home.list', { hide: ['a, b'] }),
      toggle('yt.home.bad', { hide: ['a { color: red }', 'ok'], rules: ['no scope here {}', ':scope-on x { a: b } :scope-on y { c: d }'] }),
    ]);
    const rules = [...S.compileRules('youtube')].slice(1);
    assert.deepEqual(rules, [
      'html[data-at-peace~="yt.home.list"] a { display: none !important; }',
      'html[data-at-peace~="yt.home.list"] b { display: none !important; }',
      'html[data-at-peace~="yt.home.bad"] ok { display: none !important; }',
    ]);
  });

  test('only settings of the requested site are compiled; cross-site settings never are', () => {
    S.define('yt.home', [toggle('yt.home.a', { hide: ['x'] })]);
    S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' }), toggle('general.sneaky', { hide: ['body'], feature: 'x' })]);
    assert.equal(S.compileRules('youtube').length, 2);
    assert.equal(S.compileRules('instagram').length, 1);
  });

  test('settings with unusable ids or select values are skipped instead of emitting odd attribute selectors', () => {
    S.define('yt.home', [
      toggle('yt.home.has space', { hide: ['x'] }),
      toggle('yt.home.quo"te', { hide: ['x'] }),
      selectDef('yt.home.odd', {
        options: [{ value: 'show', label: 'Show' }, { value: 'a b', label: 'Space' }, { value: 'x"y', label: 'Quote' }],
        variants: { 'a b': { hide: ['x'] }, 'x"y': { hide: ['y'] }, notAnOption: { hide: ['z'] } },
      }),
    ]);
    assert.deepEqual([...S.compileRules('youtube')], [MASTER]);
    assert.ok(S.validateRegistry().some((p) => /yt\.home\.has space: id must/.test(p)));
  });

  test('page values that are not page-type-shaped are ignored instead of injected', () => {
    S.define('yt.home', [toggle('yt.home.a', { page: 'wa"tch]', hide: ['x'] })]);
    assert.equal(S.compileRules('youtube')[1], 'html[data-at-peace~="yt.home.a"] x { display: none !important; }');
  });

  test('gate() escapes quotes and backslashes defensively', () => {
    assert.equal(S.gate('a"b\\c'), 'html[data-at-peace~="a\\"b\\\\c"]');
  });

  test('output is cached per site and refreshed when the registry changes', () => {
    S.define('yt.home', [toggle('yt.home.a', { hide: ['x'] })]);
    const first = S.compileCss('youtube');
    assert.equal(S.compileCss('youtube'), first);
    S.define('yt.home', [toggle('yt.home.b', { hide: ['y'] })]);
    assert.notEqual(S.compileCss('youtube'), first);
    assert.equal(S.compileCss('youtube').split('\n').length, 3);
  });

  test('the compiled rules are frozen (shared cache)', () => {
    assert.throws(() => S.compileRules('youtube').push('x'), TypeError);
  });
});

describe('tokensFor', () => {
  beforeEach(() => {
    S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' }), selectDef('general.theme', { feature: 'pages' })]);
    S.define('yt.home', [
      toggle('yt.home.a', { hide: ['x'] }),
      toggle('yt.home.b', { hide: ['y'] }),
      selectDef('yt.home.thumbs', { variants: { blur: { hide: ['z'] } } }),
      { id: 'yt.home.n', label: 'n', type: 'number', default: 3, feature: 'f' },
    ]);
  });

  test('master switch off → no tokens at all', () => {
    assert.deepEqual(S.tokensFor({ 'general.enabled': false, 'yt.home.a': true }, 'youtube'), []);
  });

  test('on: master token first, then true toggles and "id=value" for every select (default included)', () => {
    const tokens = S.tokensFor({ 'general.enabled': true, 'yt.home.a': true, 'yt.home.b': false, 'yt.home.thumbs': 'blur' }, 'youtube');
    assert.deepEqual(tokens, ['general.enabled', 'yt.home.a', 'yt.home.thumbs=blur']);
    assert.deepEqual(S.tokensFor({ 'general.enabled': true }, 'youtube'), ['general.enabled', 'yt.home.thumbs=show']);
  });

  test('cross-site settings other than the master never appear; numbers never appear', () => {
    const tokens = S.tokensFor({ 'general.enabled': true, 'general.theme': 'dark', 'yt.home.n': 9 }, 'youtube');
    assert.deepEqual(tokens, ['general.enabled', 'yt.home.thumbs=show']);
  });

  test('missing keys count as defaults (master defaults to on); junk values never produce tokens', () => {
    assert.deepEqual(S.tokensFor({}, 'youtube'), ['general.enabled', 'yt.home.thumbs=show']);
    assert.deepEqual(S.tokensFor(undefined, 'youtube'), ['general.enabled', 'yt.home.thumbs=show']);
    assert.deepEqual(S.tokensFor({ 'yt.home.a': 'true', 'yt.home.thumbs': 'a b' }, 'youtube'), ['general.enabled']);
  });

  test('other sites get just the master token', () => {
    assert.deepEqual(S.tokensFor({ 'general.enabled': true, 'yt.home.a': true }, 'instagram'), ['general.enabled']);
  });
});

describe('validateRegistry', () => {
  const clean = () => {
    S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' })]);
    S.define('yt.home', [toggle('yt.home.a', { hide: ['x'], tags: ['ads'], page: 'home' })]);
    S.define('pause', [toggle('pause.enabled', { feature: 'pause' })]);
    S.define('yt.watch', [toggle('yt.watch.a', { hide: ['x'] })]);
  };

  test('a well-formed registry has no problems', () => {
    clean();
    assert.deepEqual(S.validateRegistry(), []);
  });

  /** Registers one bad definition on top of a clean registry and returns the problems about it. */
  function problemsFor(sectionId, def) {
    clean();
    S.define(sectionId, [def]);
    return S.validateRegistry().filter((p) => p.startsWith(`${def.id}:`));
  }

  const cases = [
    ['missing label', 'yt.home', { id: 'yt.home.x', type: 'toggle', default: false, hide: ['a'] }, /missing label/],
    ['bad type', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'checkbox', default: false }, /type must be one of/],
    ['missing default', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'toggle', hide: ['a'] }, /missing default/],
    ['toggle default not boolean', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'toggle', default: 'no', hide: ['a'] }, /default "no" is not valid/],
    ['select default not in options', 'yt.home', selectDef('yt.home.x', { default: 'nope', feature: 'f' }), /default "nope" is not valid/],
    ['number default out of range', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'number', default: 99, max: 10, feature: 'f' }, /default 99 is not valid/],
    ['list default rejected by its own normalizer', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'list', default: ['a'], item: () => null, feature: 'f' }, /default \["a"\] is not valid/],
    ['select without options', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'select', default: 'a', feature: 'f' }, /select needs options/],
    ['options on a toggle', 'yt.home', toggle('yt.home.x', { options: [{ value: 'a', label: 'A' }], hide: ['a'] }), /options only make sense/],
    ['duplicate option values', 'yt.home', selectDef('yt.home.x', { options: [{ value: 'show', label: 'A' }, { value: 'show', label: 'B' }], feature: 'f' }), /duplicate option value "show"/],
    ['option value with bad characters', 'yt.home', selectDef('yt.home.x', { options: [{ value: 'show', label: 'A' }, { value: 'a b', label: 'B' }], feature: 'f' }), /option value "a b" may only contain/],
    ['option without label', 'yt.home', selectDef('yt.home.x', { options: [{ value: 'show' }], feature: 'f' }), /every option needs/],
    ['hide on a select', 'yt.home', selectDef('yt.home.x', { hide: ['a'] }), /hide\/rules belong on toggles/],
    ['rules on a select', 'yt.home', selectDef('yt.home.x', { rules: [':scope-on a {}'] }), /hide\/rules belong on toggles/],
    ['variants on a toggle', 'yt.home', toggle('yt.home.x', { variants: {} }), /variants belong on selects/],
    ['variant key not an option', 'yt.home', selectDef('yt.home.x', { variants: { nope: { hide: ['a'] } } }), /variants key "nope" is not an option/],
    ['hide not an array', 'yt.home', toggle('yt.home.x', { hide: 'a' }), /hide must be an array/],
    ['unsafe selector', 'yt.home', toggle('yt.home.x', { hide: ['a { b'] }), /unsafe or malformed selector/],
    ['selector list', 'yt.home', toggle('yt.home.x', { hide: ['a, b'] }), /selector list/],
    ['rule without :scope-on', 'yt.home', toggle('yt.home.x', { rules: ['a { color: red }'] }), /exactly one block starting with ":scope-on"/],
    ['two blocks in one rule', 'yt.home', toggle('yt.home.x', { rules: [':scope-on a { x: y } :scope-on b { x: y }'] }), /exactly one block/],
    ['rule with trailing junk', 'yt.home', toggle('yt.home.x', { rules: [':scope-on a { x: y } junk'] }), /exactly one block/],
    ['unbalanced rule', 'yt.home', toggle('yt.home.x', { rules: [':scope-on a { x: y'] }), /exactly one block/],
    ['does nothing', 'yt.home', toggle('yt.home.x', {}), /does nothing/],
    ['unknown property (typo)', 'yt.home', toggle('yt.home.x', { hide: ['a'], hides: ['b'] }), /unknown property "hides"/],
    ['unknown tag', 'yt.home', toggle('yt.home.x', { hide: ['a'], tags: ['recomendations'] }), /unknown tag "recomendations"/],
    ['requires unknown setting', 'yt.home', toggle('yt.home.x', { hide: ['a'], requires: 'yt.home.ghost' }), /requires unknown setting/],
    ['requires itself', 'yt.home', toggle('yt.home.x', { hide: ['a'], requires: 'yt.home.x' }), /requires itself/],
    ['bulkValue not an option', 'yt.home', selectDef('yt.home.x', { bulkValue: 'nope', variants: { hide: { hide: ['a'] } } }), /bulkValue must be one of the options/],
    ['bulkValue on a toggle', 'yt.home', toggle('yt.home.x', { bulkValue: 'a', hide: ['a'] }), /bulkValue must be one of the options/],
    ['min above max', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'number', default: 5, min: 9, max: 1, feature: 'f' }, /min is greater than max/],
    ['step zero', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'number', default: 5, step: 0, feature: 'f' }, /step must be positive/],
    ['min on a toggle', 'yt.home', toggle('yt.home.x', { min: 1, hide: ['a'] }), /min only applies to numbers/],
    ['maxItems on a number', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'number', default: 1, maxItems: 3, feature: 'f' }, /maxItems only applies to lists/],
    ['item on a toggle', 'yt.home', toggle('yt.home.x', { item: () => 1, hide: ['a'] }), /item must be a function on a list/],
    ['normalize not a function', 'yt.home', toggle('yt.home.x', { normalize: 'x', hide: ['a'] }), /normalize must be a function/],
    ['quick on a number', 'yt.home', { id: 'yt.home.x', label: 'x', type: 'number', default: 1, quick: true, feature: 'f' }, /only toggles and selects can be quick/],
    ['non-boolean flag', 'yt.home', toggle('yt.home.x', { hide: ['a'], advanced: 'yes' }), /advanced must be a boolean/],
    ['bad since', 'yt.home', toggle('yt.home.x', { hide: ['a'], since: '1.0' }), /since must look like/],
    ['bad id shape', 'yt.home', toggle('nodots', { hide: ['a'] }), /id must be dot-separated/],
    ['bad id characters', 'yt.home', toggle('yt.home.a=b', { hide: ['a'] }), /id must be dot-separated/],
    ['bad page shape', 'yt.home', toggle('yt.home.x', { hide: ['a'], page: 'Watch Page' }), /page must be a lowercase page-type name/],
    ['unknown section', 'ghost', toggle('yt.home.x', { hide: ['a'] }), /unknown section "ghost"/],
    ['site setting in a cross-site section', 'general', toggle('yt.home.x', { hide: ['a'] }), /belongs to site "youtube" but section "general" is cross-site/],
    ['cross-site setting in a site section', 'yt.home', toggle('pause.x', { feature: 'f' }), /belongs to no site \(cross-site\) but section "yt.home" is site "youtube"/],
    ['css on a cross-site setting', 'pause', toggle('pause.x', { hide: ['a'] }), /cross-site settings cannot carry CSS/],
    ['page on a cross-site setting', 'pause', toggle('pause.x', { page: 'home', feature: 'f' }), /cross-site settings cannot carry CSS or a page/],
  ];
  for (const [name, sectionId, def, expected] of cases) {
    test(`reports: ${name}`, () => {
      const problems = problemsFor(sectionId, def);
      assert.ok(problems.some((p) => expected.test(p)), `expected ${expected} in ${JSON.stringify(problems)}`);
    });
  }

  test('reports a section that says one thing and a define() that says another', () => {
    clean();
    S.define('yt.home', [toggle('yt.home.y', { hide: ['a'], section: 'yt.watch' })]);
    assert.ok(S.validateRegistry().some((p) => /yt\.home\.y: says section "yt\.watch" but was defined in "yt\.home"/.test(p)));
  });

  test('reports sections that are broken or empty', () => {
    clean();
    S.section({ id: 'empty', title: 'Empty', order: 5 });
    S.section({ id: 'untitled', site: null, order: 5 });
    S.section({ id: 'noorder', title: 'X' });
    S.section({ id: 'alien', title: 'X', order: 1, site: 'myspace' });
    const problems = S.validateRegistry();
    assert.ok(problems.includes('section "empty": has no settings'));
    assert.ok(problems.includes('section "untitled": missing title'));
    assert.ok(problems.includes('section "noorder": order must be a number'));
    assert.ok(problems.includes('section "alien": unknown site "myspace"'));
  });

  test('page types are checked once the site has registered its pages', () => {
    clean();
    S.registerPages('youtube', ['home', 'watch']);
    assert.deepEqual(S.validateRegistry(), []);
    S.define('yt.home', [toggle('yt.home.typo', { hide: ['a'], page: 'wach' })]);
    assert.ok(S.validateRegistry().some((p) => /yt\.home\.typo: unknown youtube page type "wach" \(known: home, watch\)/.test(p)));
  });

  test('a throwing hook inside a definition cannot make validateRegistry throw', () => {
    clean();
    const def = { id: 'yt.home.evil', label: 'x', type: 'list', default: [], feature: 'f', item: () => { throw new Error('boom'); } };
    S.define('yt.home', [def]);
    assert.doesNotThrow(() => S.validateRegistry());
  });
});

describe('requires: "id", "id=value", "id!=value" (Phase 4b)', () => {
  test('parseRequires reads the three forms and refuses anything else', () => {
    assert.deepEqual(S.parseRequires('pause.enabled'), { id: 'pause.enabled', op: 'truthy', value: null });
    assert.deepEqual(S.parseRequires('yt.home.feedMode=custom'), { id: 'yt.home.feedMode', op: '=', value: 'custom' });
    assert.deepEqual(S.parseRequires('yt.home.feedMode!=show'), { id: 'yt.home.feedMode', op: '!=', value: 'show' });
    assert.deepEqual(S.parseRequires('a.b=0.75'), { id: 'a.b', op: '=', value: '0.75' });
    for (const bad of ['', 'nodots', 'a.b=', 'a.b==c', 'a.b=c d', 'a.b!c', '=c', 'a.b=c=d', 'a b.c', 42, null, undefined]) {
      assert.equal(S.parseRequires(bad), null, JSON.stringify(bad));
    }
  });

  test('requiresMet: truthy follows isHidingValue; = and != compare the value as text', () => {
    const mode = selectDef('yt.home.mode');
    const flag = toggle('yt.home.flag', { hide: ['a'] });
    assert.equal(S.requiresMet({ op: 'truthy', value: null }, mode, 'show'), false);
    assert.equal(S.requiresMet({ op: 'truthy', value: null }, mode, 'blur'), true);
    assert.equal(S.requiresMet({ op: '=', value: 'blur' }, mode, 'blur'), true);
    assert.equal(S.requiresMet({ op: '=', value: 'blur' }, mode, 'hide'), false);
    assert.equal(S.requiresMet({ op: '!=', value: 'show' }, mode, 'hide'), true);
    assert.equal(S.requiresMet({ op: '!=', value: 'show' }, mode, 'show'), false);
    assert.equal(S.requiresMet({ op: '=', value: 'true' }, flag, true), true);
    assert.equal(S.requiresMet({ op: '=', value: 'true' }, flag, false), false);
  });

  /** One dependent setting (ids are unique per call, so one test can try several) on a small clean registry. */
  let n = 0;
  const problemsFor = (requires) => {
    if (n++ === 0 || !S.get('yt.home.mode')) {
      S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' })]);
      S.define('yt.home', [
        selectDef('yt.home.mode', { variants: { blur: { hide: ['a'] } } }),
        toggle('yt.home.flag', { hide: ['b'] }),
        { id: 'yt.home.n', label: 'n', type: 'number', default: 1, feature: 'f' },
      ]);
      S.define('pause', [toggle('pause.enabled', { feature: 'pause' })]);
    }
    const id = `yt.watch.x${n}`;
    S.define('yt.watch', [toggle(id, { hide: ['c'], requires: requires.replace('SELF', id) })]);
    return S.validateRegistry().filter((p) => p.startsWith(`${id}:`));
  };

  test('valid forms pass validateRegistry', () => {
    for (const requires of ['yt.home.mode', 'yt.home.mode=blur', 'yt.home.mode!=show', 'yt.home.flag=true', 'yt.home.flag!=false', 'yt.home.n']) {
      assert.deepEqual(problemsFor(requires), [], requires);
    }
  });

  test('reports malformed, unknown, self-referencing and impossible conditions', () => {
    assert.match(problemsFor('yt.home.mode==blur')[0], /requires must look like/);
    assert.match(problemsFor('yt.home.ghost=blur')[0], /requires unknown setting "yt.home.ghost"/);
    assert.match(problemsFor('SELF')[0], /requires itself/);
    assert.match(problemsFor('yt.home.mode=nope')[0], /"nope" is not a value of yt.home.mode \(show, blur, hide\)/);
    assert.match(problemsFor('yt.home.flag=maybe')[0], /"maybe" is not a value of yt.home.flag \(true, false\)/);
    assert.match(problemsFor('yt.home.n=3')[0], /only works for a select or a toggle/);
  });
});

describe('short option labels (Phase 4b)', () => {
  let count = 0;
  const withOptions = (options) => {
    if (count++ === 0) {
      S.define('general', [toggle('general.enabled', { default: true, feature: 'engine' })]);
      S.define('pause', [toggle('pause.enabled', { feature: 'pause' })]);
    }
    const id = `yt.home.mode${count}`;
    S.define('yt.home', [selectDef(id, { options, feature: 'f' })]);
    return S.validateRegistry().filter((p) => p.startsWith(`${id}:`));
  };

  test('a short label is fine, and the label stays what validateValue/coerce see', () => {
    assert.deepEqual(withOptions([{ value: 'show', label: 'Show the whole feed', short: 'Show' }, { value: 'hide', label: 'Hide it', short: 'Hide' }]), []);
    assert.equal(S.validateValue(S.get('yt.home.mode1'), 'hide'), 'hide');
  });

  test('a short label must be a non-empty string of at most 16 characters', () => {
    for (const short of ['', '   ', 7, null, 'x'.repeat(17)]) {
      const found = withOptions([{ value: 'show', label: 'Show', short }, { value: 'hide', label: 'Hide' }]);
      assert.ok(found.some((p) => /short label must be a non-empty string of at most 16 characters/.test(p)), JSON.stringify(short));
    }
    assert.deepEqual(withOptions([{ value: 'show', label: 'Show', short: 'x'.repeat(16) }, { value: 'hide', label: 'Hide' }]), []);
  });

  test('other keys on an option are reported (a typo like "shrt" would silently do nothing)', () => {
    assert.ok(withOptions([{ value: 'show', label: 'Show', shrt: 'S' }, { value: 'hide', label: 'Hide' }]).some((p) => /unknown property "shrt"/.test(p)));
  });
});
