// The design tokens (src/pages/common/tokens.css) have to stay readable: WCAG 2.x contrast of the
// text and control colours against the grounds, in both themes, and of the fixed indigo palette
// that the pause page, the blocked page and the session-expiry overlay use. The numbers quoted in
// the header of tokens.css come from here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_load.mjs';

const css = readFileSync(join(ROOT, 'src/pages/common/tokens.css'), 'utf8');

/** Custom properties declared inside the block that starts with `selector {`. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no block for ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}

const light = tokens(':root');
const dark = tokens(':root[data-theme="dark"]');
// "Match my system" repeats the dark values inside a media query: they must not drift apart.
const system = tokens('  :root[data-theme="system"]');
// The indigo world is its own palette, the same in both themes.
const indigo = tokens('html');

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [name, t] of [
  ['light', light],
  ['dark', dark],
]) {
  describe(`${name} theme`, () => {
    test('body text on the ground and on panels reaches 7:1', () => {
      for (const ground of ['ground', 'panel']) assert.ok(ratio(t.text, t[ground]) >= 7, `text on ${ground} ${ratio(t.text, t[ground])}`);
    });

    test('secondary text reaches 4.5:1 on the ground, on panels, on the selected nav tile and on the popup\'s segmented track', () => {
      for (const ground of ['ground', 'panel', 'act-soft', 'panel-line']) assert.ok(ratio(t['text-2'], t[ground]) >= 4.5, `text-2 on ${ground} ${ratio(t['text-2'], t[ground])}`);
    });

    test('links and selected nav (act) reach 4.5:1 on the ground, on panels and on the selected tile', () => {
      for (const ground of ['ground', 'panel', 'act-soft']) assert.ok(ratio(t.act, t[ground]) >= 4.5, `act on ${ground} ${ratio(t.act, t[ground])}`);
    });

    test('text on a primary button (on-act on act) reaches 4.5:1', () => {
      assert.ok(ratio(t['on-act'], t.act) >= 4.5, `on-act on act ${ratio(t['on-act'], t.act)}`);
    });

    test('positive (mint-text), time (amber-text) and error (danger) text reach 4.5:1 on the ground and on panels', () => {
      for (const color of ['mint-text', 'amber-text', 'danger']) {
        for (const ground of ['ground', 'panel']) assert.ok(ratio(t[color], t[ground]) >= 4.5, `${color} on ${ground} ${ratio(t[color], t[ground])}`);
      }
    });

    test('control boundaries (a field\'s border, a switch that is off) reach 3:1 on panels and on the ground', () => {
      for (const color of ['field-line', 'switch-off']) {
        for (const ground of ['panel', 'ground']) assert.ok(ratio(t[color], t[ground]) >= 3, `${color} on ${ground} ${ratio(t[color], t[ground])}`);
      }
    });

    test('the switch knob (white) reaches 3:1 on its off track', () => {
      assert.ok(ratio('#FFFFFF', t['switch-off']) >= 3, `knob on switch-off ${ratio('#FFFFFF', t['switch-off'])}`);
    });

    test('the focus ring (act) reaches 3:1 on the ground and on panels', () => {
      for (const ground of ['ground', 'panel']) assert.ok(ratio(t.act, t[ground]) >= 3, `act on ${ground} ${ratio(t.act, t[ground])}`);
    });
  });
}

describe('indigo moments (pause, blocked, session over)', () => {
  test('text reaches 7:1 on the ground and on raised fields', () => {
    for (const ground of ['ix-ground', 'ix-raised']) assert.ok(ratio(indigo['ix-text'], indigo[ground]) >= 7, `text on ${ground}`);
    for (const ground of ['ix-ground', 'ix-raised']) assert.ok(ratio(indigo['ix-text-2'], indigo[ground]) >= 7, `text-2 on ${ground}`);
  });

  test('quiet text (kicker, address, hints) reaches 4.5:1 on the ground', () => {
    assert.ok(ratio(indigo['ix-quiet'], indigo['ix-ground']) >= 4.5, `quiet on ground ${ratio(indigo['ix-quiet'], indigo['ix-ground'])}`);
  });

  test('mint and amber reach 4.5:1 on the ground (they carry words: links, the kicker)', () => {
    for (const color of ['ix-mint', 'ix-amber']) assert.ok(ratio(indigo[color], indigo['ix-ground']) >= 4.5, `${color} on ground ${ratio(indigo[color], indigo['ix-ground'])}`);
  });

  test('the primary button text reaches 7:1 on mint', () => {
    assert.ok(ratio(indigo['ix-on-mint'], indigo['ix-mint']) >= 7, `on-mint on mint ${ratio(indigo['ix-on-mint'], indigo['ix-mint'])}`);
  });

  test('the intention field\'s boundary reaches 3:1 on the raised field and on the ground', () => {
    for (const ground of ['ix-raised', 'ix-ground']) assert.ok(ratio(indigo['ix-field-line'], indigo[ground]) >= 3, `field-line on ${ground} ${ratio(indigo['ix-field-line'], indigo[ground])}`);
  });
});

test('"Match my system" uses exactly the dark tokens', () => {
  for (const [name, value] of Object.entries(dark)) assert.equal(system[name], value, name);
});

test('light and dark define the same set of colour tokens', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
});
