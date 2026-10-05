// The one polling helper every browser-driven spec uses (Chromium/Playwright and real Firefox/Selenium).
//
// Why this exists: Playwright's `page.waitForFunction(async () => …)` does NOT await a predicate that
// returns a promise. A Promise is truthy, so the wait resolves at once and the assertion after it runs
// against a state that may not have arrived yet (it passes when the machine is fast and fails, or worse,
// passes vacuously, when it is not). Anything that has to ask the browser an async question (storage,
// a message to the background, a call into an extension page) must be polled from Node instead, with
// this helper, which awaits every check.
//
//   await until(() => stored().then((s) => s.ok === true), { what: 'the setting to be saved' });
//   await pageUntil(page, async (key) => (await chrome.storage.local.get('settings')).settings?.[key] === true, id);
//
// Synchronous in-page predicates (`page.waitForFunction(() => document.querySelector(…))`) are fine as
// they are: they are re-evaluated by Playwright on every animation frame.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `check` until it returns something truthy and resolves with that value. Rejects after the
 * timeout with a message naming what was being waited for.
 *
 *   until(check)                                  15 s, every 50 ms
 *   until(check, 'the toast')                     what the message names
 *   until(check, 'the toast', 5000)               … and a timeout in ms
 *   until(check, 5000)
 *   until(check, { what, timeout, interval, retryErrors })
 *
 * An error thrown by `check` propagates at once, unless `retryErrors` is set (WebDriver calls throw while a
 * page is navigating or an element is stale): then it counts as "not yet" and is quoted if time runs out.
 *
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {...(string | number | { timeout?: number, interval?: number, what?: string, retryErrors?: boolean })} rest
 * @returns {Promise<Awaited<T>>}
 */
export async function until(check, ...rest) {
  const options = {};
  for (const arg of rest) {
    if (typeof arg === 'number') options.timeout = arg;
    else if (typeof arg === 'string') options.what = arg;
    else if (arg && typeof arg === 'object') Object.assign(options, arg);
  }
  const { timeout = 15_000, interval = 50, what, retryErrors = false } = options;
  const end = Date.now() + timeout;
  let lastError;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
      lastError = undefined;
    } catch (err) {
      if (!retryErrors) throw err;
      lastError = err;
    }
    if (Date.now() >= end) {
      const label = what ?? String(check).replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`timed out after ${timeout} ms waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
    }
    await sleep(interval);
  }
}

/**
 * The Playwright flavour: re-runs `fn(arg)` inside the page until it resolves truthy. Unlike
 * `page.waitForFunction`, `fn` may be async (it is run with `page.evaluate`, which awaits it).
 *
 * @template A
 * @param {{ evaluate: (fn: (arg: A) => unknown, arg?: A) => Promise<unknown> }} page  a Playwright Page
 * @param {(arg: A) => unknown} fn
 * @param {A} [arg]
 * @param {...(string | number | { timeout?: number, interval?: number, what?: string })} rest  as for `until`
 */
export function pageUntil(page, fn, arg, ...rest) {
  return until(() => page.evaluate(fn, arg), { what: String(fn).replace(/\s+/g, ' ').slice(0, 160) }, ...rest);
}
