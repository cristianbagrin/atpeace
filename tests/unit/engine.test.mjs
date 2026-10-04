// The pure parts of the content engine (src/content/engine.js): activity rule, CSS sanitizing,
// the dynamic stylesheet and mutation-root collapsing. No DOM needed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';

let AP;
let E;

before(async () => {
  ({ AP } = await freshWorld({ engine: true }));
  E = AP.engine;
});
after(() => uninstallFakeBrowser());

describe('isOn / isFeatureActive (PLAN §7.6)', () => {
  test('true, non-zero numbers, non-empty lists and non-"off" strings are on', () => {
    for (const on of [true, 1, -3, 0.5, 'hide', 'subscriptions', '1.5', 'sentence', ['a']]) assert.equal(E.isOn(on), true, JSON.stringify(on));
  });

  test('false, zero, empty, show/allow/default/off/none, objects and nonsense are off', () => {
    for (const off of [false, 0, NaN, Infinity, '', 'show', 'allow', 'default', 'off', 'none', [], {}, { a: 1 }, null, undefined]) {
      assert.equal(E.isOn(off), false, String(off));
    }
  });

  test('a feature is active when any of its settings is on, unless it brings its own isActive()', () => {
    const ctx = { settings: { 'a.x': false, 'a.y': 'show', 'a.z': 'hide', page: 'home' } };
    assert.equal(E.isFeatureActive({ settings: ['a.x', 'a.y'] }, ctx), false);
    assert.equal(E.isFeatureActive({ settings: ['a.x', 'a.z'] }, ctx), true);
    assert.equal(E.isFeatureActive({ settings: [] }, ctx), false);
    assert.equal(E.isFeatureActive({}, ctx), false);
    assert.equal(E.isFeatureActive({ settings: ['a.x'], isActive: () => true }, ctx), true, 'isActive wins');
    assert.equal(E.isFeatureActive({ settings: ['a.z'], isActive: () => false }, ctx), false);
    assert.equal(E.isFeatureActive({ settings: ['missing.id'] }, ctx), false);
  });
});

describe('sanitizeCustomCss', () => {
  const clean = (css) => E.sanitizeCustomCss(css);

  test('ordinary CSS passes through (trimmed)', () => {
    assert.equal(clean('  ytd-masthead { opacity: .5 }\n.a > .b { color: red }  '), 'ytd-masthead { opacity: .5 }\n.a > .b { color: red }');
    assert.equal(clean('a { background: linear-gradient(red, blue) }'), 'a { background: linear-gradient(red, blue) }');
  });

  test('non-strings and blanks become ""', () => {
    for (const v of [undefined, null, 5, {}, [], '', '   \n']) assert.equal(clean(v), '');
  });

  test('@import is removed, in any case and with media queries', () => {
    assert.equal(clean('@import url("https://evil.example/a.css");\na { color: red }'), 'a { color: red }');
    assert.equal(clean('@IMPORT "x.css" screen;a { color: red }'), 'a { color: red }');
    assert.equal(clean('@import url(x.css)'), '');
  });

  test('url() is kept only for data: URLs; everything else is neutralized', () => {
    assert.equal(clean('a { background: url(data:image/png;base64,AAAA) }'), 'a { background: url(data:image/png;base64,AAAA) }');
    assert.equal(clean('a { background: url("data:image/svg+xml;utf8,<svg/>") }'), 'a { background: url("data:image/svg+xml;utf8,<svg/>") }');
    assert.equal(clean("a { background: url( 'data:image/png;base64,AAAA' ) }"), "a { background: url( 'data:image/png;base64,AAAA' ) }");
    assert.equal(clean('a { background: url(https://evil.example/x.png) }'), 'a { background: none }');
    assert.equal(clean('a { background: url("//evil.example/x.png") }'), 'a { background: none }');
    assert.equal(clean('a { background: url(/relative.png) }'), 'a { background: none }');
    assert.equal(clean('a { background: URL( x ) }'), 'a { background: none }');
    assert.equal(clean('a { cursor: url(x.cur), auto; background: url(a.png), url(b.png) }'), 'a { cursor: none, auto; background: none, none }');
    assert.equal(clean('@font-face { font-family: f; src: url(https://evil.example/f.woff2) }'), '@font-face { font-family: f; src: none }');
  });

  test('functions that can fetch an image are disarmed', () => {
    for (const fn of ['image-set', '-webkit-image-set', 'image', 'cross-fade', 'element', '-moz-element', '-moz-image-rect', 'src']) {
      const out = clean(`a { background: ${fn}("https://evil.example/x.png" 1x) }`);
      assert.ok(!new RegExp(`(?<![\\w-])${fn}\\s*\\(`).test(out), `${fn} survived: ${out}`);
      assert.ok(out.includes('blocked('), fn);
    }
    assert.equal(clean('a { mask-image: linear-gradient(black, transparent) }'), 'a { mask-image: linear-gradient(black, transparent) }');
    assert.equal(clean('a { background-image: none }'), 'a { background-image: none }');
  });

  test('comments and </style are removed (also where they would glue a forbidden token together)', () => {
    assert.equal(clean('/* @import url(x); */ a { color: red }'), 'a { color: red }');
    assert.equal(clean('a { color: red } </style><script>alert(1)</script>'), 'a { color: red } ><script>alert(1)</script>');
    assert.equal(clean('a { color: red } </STYLE >'), 'a { color: red }  >');
    assert.equal(clean('a { background: u/**/rl(https://evil.example) }'), 'a { background: none }');
    assert.equal(clean('a { color: red } /* unterminated'), 'a { color: red }');
  });

  test('escape-obfuscated forbidden constructs reject the whole text', () => {
    assert.equal(clean('@\\69mport url(https://evil.example/x.css); a { color: red }'), '');
    assert.equal(clean('a { background: \\75rl(https://evil.example/x.png) }'), '');
    assert.equal(clean('a { background: u\\72l(https://evil.example/x.png) }'), '');
    assert.equal(clean('a { background: \\000075rl(https://evil.example/x.png) }'), '');
    assert.equal(clean('a { background: image\\2d set("https://evil.example/x.png" 1x) }'), '');
  });

  test('harmless escapes survive untouched', () => {
    assert.equal(clean('.a\\:b { color: red }'), '.a\\:b { color: red }');
    assert.equal(clean('a::before { content: "\\201C" }'), 'a::before { content: "\\201C" }');
  });
});

describe('buildDynamicCss', () => {
  const build = (settings, options) => E.buildDynamicCss({ 'general.enabled': true, ...settings }, options);
  const rule = (extra) => ({ id: 'r1', selector: 'ytd-masthead #logo', page: null, note: '', createdAt: 1, ...extra });

  test('is empty when the master switch is off (even with rules and CSS), and for missing settings', () => {
    assert.equal(E.buildDynamicCss({ 'general.enabled': false, 'advanced.customRules': [rule()], 'advanced.customCss': 'a { color: red }' }, { site: 'youtube' }), '');
    assert.equal(E.buildDynamicCss(undefined, { site: 'youtube' }), '');
    assert.equal(build({}), '');
  });

  test('picker rules hide under the master token, optionally scoped to a page', () => {
    const css = build({ 'advanced.customRules': [rule(), rule({ id: 'r2', selector: '#related', page: 'watch' })] }, { site: 'youtube' });
    assert.equal(
      css,
      [
        'html[data-at-peace~="general.enabled"] ytd-masthead #logo { display: none !important; }',
        'html[data-at-peace~="general.enabled"]:is([data-at-peace-page="watch"],[data-at-peace-next="watch"]) #related { display: none !important; }',
      ].join('\n'),
    );
  });

  test('selector lists become one rule per selector; unsafe selectors and non-rules are skipped', () => {
    const css = build({ 'advanced.customRules': [rule({ selector: 'a, b' }), rule({ id: 'r2', selector: 'a { color: red }' }), null, 'x', { id: 'r3' }] }, { site: 'youtube' });
    assert.deepEqual(css.split('\n'), [
      'html[data-at-peace~="general.enabled"] a { display: none !important; }',
      'html[data-at-peace~="general.enabled"] b { display: none !important; }',
    ]);
  });

  test('a rule made for another site is not applied here; one without a site is', () => {
    const settings = { 'advanced.customRules': [rule({ site: 'instagram' }), rule({ id: 'r2', selector: '#mine', site: 'youtube' }), rule({ id: 'r3', selector: '#any' })] };
    assert.deepEqual(build(settings, { site: 'youtube' }).split('\n').map((l) => l.match(/\] (\S+) \{/)[1]), ['#mine', '#any']);
  });

  test('custom CSS is sanitized and appended after the rules', () => {
    const css = build({ 'advanced.customRules': [rule()], 'advanced.customCss': '@import url(x);\nytd-app { opacity: .9 }' }, { site: 'youtube' });
    assert.ok(css.endsWith('\nytd-app { opacity: .9 }'));
    assert.ok(!css.includes('@import'));
  });

  test('the site hook adds CSS; a throwing hook is logged and ignored', () => {
    assert.equal(build({}, { extra: () => 'x { y: z }' }), 'x { y: z }');
    assert.equal(build({}, { extra: () => 5 }), '');
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(build({ 'advanced.customCss': 'a { b: c }' }, { extra: () => { throw new Error('boom'); } }), 'a { b: c }');
    } finally {
      console.warn = warn;
    }
  });
});

describe('collapseRoots', () => {
  const node = (name, parent = null, extra = {}) => ({ name, parentNode: parent, isConnected: true, ...extra });

  test('a node inside another node of the batch is dropped; siblings and unrelated nodes stay', () => {
    const a = node('a');
    const b = node('b', a);
    const c = node('c', b);
    const d = node('d');
    const e = node('e', node('outside'));
    assert.deepEqual(E.collapseRoots([c, b, a, d, e]).map((n) => n.name), ['a', 'd', 'e']);
  });

  test('disconnected nodes are dropped; order is kept; Sets and arrays both work', () => {
    const a = node('a', null, { isConnected: false });
    const b = node('b');
    const c = node('c');
    assert.deepEqual(E.collapseRoots(new Set([a, c, b])).map((n) => n.name), ['c', 'b']);
    assert.deepEqual(E.collapseRoots([]), []);
  });

  test('deep chains are handled', () => {
    let parent = null;
    const chain = Array.from({ length: 500 }, (_, i) => (parent = node(`n${i}`, parent)));
    assert.deepEqual(E.collapseRoots(chain).map((n) => n.name), ['n0']);
  });
});
