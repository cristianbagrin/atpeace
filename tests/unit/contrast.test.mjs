// The design tokens (src/pages/common/tokens.css) have to stay readable: WCAG 2.x contrast of the
// text and control colours against both grounds, in both themes. The numbers quoted in the
// header of tokens.css come from here.
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
    test('body text on the page and on raised rows reaches 7:1', () => {
      assert.ok(ratio(t.ink, t.paper) >= 7, `ink on paper ${ratio(t.ink, t.paper)}`);
      assert.ok(ratio(t.ink, t['paper-2']) >= 7, `ink on paper-2 ${ratio(t['paper-2'], t.ink)}`);
    });

    test('secondary text reaches 4.5:1 on both grounds', () => {
      assert.ok(ratio(t['ink-2'], t.paper) >= 4.5, `ink-2 on paper ${ratio(t['ink-2'], t.paper)}`);
      assert.ok(ratio(t['ink-2'], t['paper-2']) >= 4.5, `ink-2 on paper-2 ${ratio(t['ink-2'], t['paper-2'])}`);
    });

    test('"saved" (olive) and error (danger) text reach 4.5:1 on both grounds', () => {
      for (const color of ['olive', 'danger']) {
        for (const ground of ['paper', 'paper-2']) assert.ok(ratio(t[color], t[ground]) >= 4.5, `${color} on ${ground} ${ratio(t[color], t[ground])}`);
      }
    });

    test('control borders and focus rings reach 3:1 on both grounds', () => {
      for (const color of ['edge', 'clay']) {
        for (const ground of ['paper', 'paper-2']) assert.ok(ratio(t[color], t[ground]) >= 3, `${color} on ${ground} ${ratio(t[color], t[ground])}`);
      }
    });

    test('the seal reaches 3:1 on the page (it is a graphic, not text)', () => {
      assert.ok(ratio(t.seal, t.paper) >= 3, `seal on paper ${ratio(t.seal, t.paper)}`);
    });
  });
}

test('"Match my system" uses exactly the dark tokens', () => {
  for (const [name, value] of Object.entries(dark)) assert.equal(system[name], value, name);
});

test('light and dark define the same set of colour tokens', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
});
