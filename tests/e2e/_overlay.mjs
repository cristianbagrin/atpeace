// Helpers for the session-over overlay (src/content/overlay.js) in Chromium.
//
// The overlay lives in a CLOSED shadow root. Like the picker's panel it is read and clicked through
// the DevTools protocol (tests/e2e/_picker.mjs: inShadow), with real mouse events at the buttons'
// on-screen positions. The host element exposes two attributes the page can see: the title
// (`data-at-peace-overlay`) and the view (`data-at-peace-view`: note | breath | choice).
import { inShadow } from './_picker.mjs';

const HOST = '[data-at-peace-overlay]';

/** The view the overlay shows ('note' | 'breath' | 'choice'), or null when there is no overlay. */
export const overlayView = (page) => page.evaluate(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-view') ?? null);

export const waitOverlay = (page, view, timeout = 10_000) =>
  page.waitForFunction((v) => (document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-view') ?? null) === v, view, { timeout });

export const waitNoOverlay = (page, timeout = 10_000) => page.waitForFunction(() => document.querySelector('[data-at-peace-overlay]') === null, null, { timeout });

/** Everything the overlay shows right now (or null): text pieces, buttons with boxes, chips, the dial. */
export function readOverlay(page) {
  return inShadow(
    page,
    HOST,
    `function () {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const q = (s) => this.querySelector(s);
      const text = (el) => (el ? el.textContent : null);
      return {
        card: q('.card').className,
        title: text(q('h2')),
        kicker: text(q('.kicker')),
        body: [...this.querySelectorAll('.text > p:not(.kicker):not(.hint):not(.countdown):not(.problem)')].map((p) => p.textContent),
        hint: text(q('.hint')),
        problem: text(q('.problem')),
        countdown: q('.countdown') && !q('.countdown').hidden ? q('.countdown').textContent : null,
        buttons: [...this.querySelectorAll('.actions button')].map((b) => ({ label: b.childNodes[0].textContent, primary: b.classList.contains('primary'), disabled: b.disabled, ...rect(b) })),
        chips: [...this.querySelectorAll('.chip')].map((b) => ({ label: b.textContent, pressed: b.getAttribute('aria-pressed') === 'true', ...rect(b) })),
        dial: Boolean(q('.dial')),
        glyph: Boolean(q('.glyph')),
        sun: q('.sun') ? getComputedStyle(q('.sun')).transform : null,
        focused: this.activeElement ? this.activeElement.textContent : null,
        card_rect: rect(q('.card')),
      };
    }`,
  );
}

/** Clicks a button (or a minutes chip) of the overlay by its label, with the real mouse. */
export async function clickInOverlay(page, label) {
  const info = await readOverlay(page);
  if (!info) throw new Error('no overlay');
  const hit = [...info.buttons, ...info.chips].find((b) => b.label === label);
  if (!hit) throw new Error(`no "${label}" in the overlay (have: ${[...info.buttons, ...info.chips].map((b) => b.label).join(', ')})`);
  if (hit.disabled) throw new Error(`"${label}" is disabled`);
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
}
