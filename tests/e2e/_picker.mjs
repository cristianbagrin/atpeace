// Helpers for driving the element picker in Chromium (tests/e2e/picker.spec.mjs).
//
// The picker's panel lives in a CLOSED shadow root, which Playwright locators cannot see. DevTools
// can: Chrome DevTools Protocol `DOM.describeNode` with `pierce` returns closed roots, and
// `Runtime.callFunctionOn` runs a function with the root as `this`. So tests read the panel (text,
// buttons, highlight boxes) and CLICK its buttons with real mouse events at their on-screen
// coordinates, exactly as a person would, without any test hook in the shipped code.
import { getContext, evalInExtension } from './harness.mjs';

const sessions = new WeakMap();

/** One CDP session per page; it also remembers the page's execution contexts (the extension's isolated world is one). */
async function session(page) {
  if (!sessions.has(page)) {
    const cdp = await getContext().newCDPSession(page);
    cdp.contexts = new Map();
    cdp.on('Runtime.executionContextCreated', ({ context }) => cdp.contexts.set(context.id, context));
    cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => cdp.contexts.delete(executionContextId));
    cdp.on('Runtime.executionContextsCleared', () => cdp.contexts.clear());
    await cdp.send('Runtime.enable');
    sessions.set(page, cdp);
  }
  return sessions.get(page);
}

/** The id of the browser tab that shows `page` (the extension needs it to message the content script). */
export async function tabIdFor(page) {
  const url = page.url();
  const id = await evalInExtension(async (u) => {
    const tabs = await chrome.tabs.query({});
    const mine = tabs.filter((t) => t.url === u);
    return mine.length ? mine[mine.length - 1].id : null;
  }, url);
  if (id === null) throw new Error(`no browser tab for ${url}`);
  return id;
}

/** Sends START_PICKER to the page's content script, the way the background does. */
export async function startPicker(page) {
  const id = await tabIdFor(page);
  return evalInExtension((tabId) => chrome.tabs.sendMessage(tabId, { type: 'START_PICKER' }), id);
}

/** 'pick' | 'review' | 'done' | null: the picker host's own attribute (the only thing exposed to the page). */
export async function phase(page) {
  return page.evaluate(() => document.querySelector('[data-at-peace-picker]')?.getAttribute('data-at-peace-picker') ?? null);
}

export const waitPhase = (page, wanted, timeout = 8000) =>
  page.waitForFunction((w) => (document.querySelector('[data-at-peace-picker]')?.getAttribute('data-at-peace-picker') ?? null) === w, wanted, { timeout });

async function shadowRootObjectId(page) {
  const cdp = await session(page);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[data-at-peace-picker]")' });
  if (!result.objectId) return null;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId, depth: 1, pierce: true });
  const root = node.shadowRoots?.[0];
  if (!root) return null;
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: root.backendNodeId });
  return object.objectId;
}

/** Runs `fn` (a function declaration string) with the panel's shadow root as `this`. */
async function inPanel(page, fn, args = []) {
  const objectId = await shadowRootObjectId(page);
  if (!objectId) return null;
  const cdp = await session(page);
  const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/**
 * What the panel shows right now: text, selector, count line, notes, buttons and radios with their
 * boxes, the highlight box and how many "similar" outlines are drawn. Null when the picker is not up.
 */
export function readPanel(page) {
  return inPanel(
    page,
    `function () {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const q = (s) => this.querySelector(s);
      const target = q('.box.target');
      return {
        text: q('.body').textContent,
        selector: q('code.sel') ? q('code.sel').textContent : null,
        count: q('.count') ? q('.count').textContent : null,
        notes: [...this.querySelectorAll('.note, .fine')].map((n) => n.textContent),
        buttons: [...this.querySelectorAll('button')].map((b) => ({ label: b.childNodes[0].textContent, disabled: b.disabled, ...rect(b) })),
        radios: [...this.querySelectorAll('[role=radio]')].map((r) => ({ label: r.textContent, checked: r.getAttribute('aria-checked') === 'true', ...rect(r) })),
        checkbox: q('input[type=checkbox]') ? { checked: q('input[type=checkbox]').checked, ...rect(q('input[type=checkbox]')) } : null,
        target: target.style.display === 'block' ? { ...rect(target), refused: target.classList.contains('refused') } : null,
        similarBoxes: [...this.querySelectorAll('.box.similar')].filter((b) => b.style.display === 'block').length,
        panel: rect(q('.panel')),
        theme: q('.layer').dataset.theme,
      };
    }`,
  );
}

/** Clicks a panel button or radio by its label ("Bigger", "Hide", "Undo", "Everywhere"…), with the real mouse. */
export async function clickInPanel(page, label) {
  const info = await readPanel(page);
  if (!info) throw new Error('the picker is not showing');
  const hit = [...info.buttons, ...info.radios].find((b) => b.label === label || b.label.startsWith(label));
  if (!hit) throw new Error(`no "${label}" in the panel (have: ${[...info.buttons, ...info.radios].map((b) => b.label).join(', ')})`);
  if (hit.disabled) throw new Error(`"${label}" is disabled`);
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
}

/** Toggles the "Only this one" checkbox with a real click. */
export async function clickOnlyThisOne(page) {
  const info = await readPanel(page);
  if (!info?.checkbox) throw new Error('no "Only this one" checkbox');
  await page.mouse.click(info.checkbox.x + info.checkbox.width / 2, info.checkbox.y + info.checkbox.height / 2);
}

/**
 * How many listeners the extension's content-script world has on `window` (a different world from the
 * page's own): equal before start and after stop = the picker leaked none.
 */
export async function windowListenerCount(page) {
  const cdp = await session(page);
  const ours = [...cdp.contexts.values()].find((c) => c.auxData?.type === 'isolated' && c.name === 'At Peace');
  if (!ours) throw new Error(`no isolated world for the extension (have: ${[...cdp.contexts.values()].map((c) => c.name)})`);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window', contextId: ours.id });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  return listeners.length;
}

/** Waits for the engine to have written the page tokens (settings loaded, dynamic stylesheet in place). */
export async function waitEngine(page) {
  await page.waitForSelector('html[data-fixture-ready][data-at-peace-loaded]', { state: 'attached' });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-at-peace-page') && document.documentElement.hasAttribute('data-at-peace'), null, { timeout: 10_000 });
}

/** Computed `display` of every element matching `selector`: [] when nothing matches. */
export const displays = (page, selector) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => getComputedStyle(e).display), selector);

/** True when every match of `selector` is display:none (and there is at least one). */
export async function allHidden(page, selector) {
  const list = await displays(page, selector);
  return list.length > 0 && list.every((d) => d === 'none');
}

/** True when no match of `selector` is display:none (and there is at least one). */
export async function noneHidden(page, selector) {
  const list = await displays(page, selector);
  return list.length > 0 && list.every((d) => d !== 'none');
}

/** The stored rules, read from storage.local. */
export async function storedRules() {
  const { settings } = await evalInExtension(() => chrome.storage.local.get('settings'));
  return settings?.['advanced.customRules'] ?? [];
}
