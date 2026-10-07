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

describe('buildDynamicCss', () => {
  const build = (settings, options) => E.buildDynamicCss({ 'general.enabled': true, ...settings }, options);
  const rule = (extra) => ({ id: 'r1', selector: 'ytd-masthead #logo', page: null, note: '', createdAt: 1, ...extra });

  test('is empty when the master switch is off (even with rules), and for missing settings', () => {
    assert.equal(E.buildDynamicCss({ 'general.enabled': false, 'advanced.customRules': [rule()] }, { site: 'youtube' }), '');
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

  test('there is no custom CSS any more: a leftover value is not applied, and nothing exports the sanitizer', () => {
    const css = build({ 'advanced.customRules': [rule()], 'advanced.customCss': 'ytd-app { opacity: .9 }' }, { site: 'youtube' });
    assert.equal(css, 'html[data-at-peace~="general.enabled"] ytd-masthead #logo { display: none !important; }');
    assert.equal(E.sanitizeCustomCss, undefined);
  });

  test('the site hook adds CSS; a throwing hook is logged and ignored', () => {
    assert.equal(build({}, { extra: () => 'x { y: z }' }), 'x { y: z }');
    assert.equal(build({}, { extra: () => 5 }), '');
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(build({ 'advanced.customRules': [rule()] }, { site: 'youtube', extra: () => { throw new Error('boom'); } }), 'html[data-at-peace~="general.enabled"] ytd-masthead #logo { display: none !important; }');
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
