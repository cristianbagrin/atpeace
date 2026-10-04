// Functions that run INSIDE the YouTube page (main world), shared by the Chromium spec
// (tests/e2e/engine.spec.mjs, Playwright `page.evaluate`) and the real-Firefox spec
// (tests/firefox/engine.mjs, Selenium `executeScript`). Each one must be self-contained: it is
// serialized with toString() and re-created in the browser, so it cannot use imports or closures.
// The page cannot see our content script's world; everything observable here is DOM state.

/** What the engine has put into the DOM. */
export function engineState() {
  const html = document.documentElement;
  const style = document.getElementById('at-peace-style');
  const dynamic = document.getElementById('at-peace-dynamic');
  let parsedRules;
  try {
    parsedRules = style?.sheet ? style.sheet.cssRules.length : null;
  } catch {
    parsedRules = 'blocked'; // Firefox: a content script's sheet is "cross-origin" to the page
  }
  return {
    loaded: html.getAttribute('data-at-peace-loaded'),
    tokens: html.getAttribute('data-at-peace'),
    page: html.getAttribute('data-at-peace-page'),
    next: html.getAttribute('data-at-peace-next'),
    styleInDocument: Boolean(style) && style.parentNode === html,
    dynamicInDocument: Boolean(dynamic) && dynamic.parentNode === html,
    rules: style ? style.getAttribute('data-rules') : null,
    parsedRules,
    css: style ? style.textContent : null,
    dynamic: dynamic ? dynamic.textContent : null,
    path: location.pathname + location.search,
    leakedNamespace: typeof window.AtPeace !== 'undefined',
  };
}

/** Computed display/visibility/size of the first element matching `selector`, or null. */
export function elementInfo(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return { display: cs.display, outlineStyle: cs.outlineStyle, opacity: cs.opacity, width: Math.round(rect.width), height: Math.round(rect.height) };
}

/** Sets a marker that survives SPA changes but not a reload. */
export function setReloadMarker() {
  window.__atPeaceMarker = String(Math.random());
  return window.__atPeaceMarker;
}

export function getReloadMarker() {
  return window.__atPeaceMarker ?? null;
}

/**
 * Starts recording (a) every [page, next] attribute state the <html> element goes through and
 * (b) per animation frame, how many elements matching `selector` are PAINTED (displayed, sized,
 * visible) while at least one such element exists. A frame with a painted element is a visible
 * flash of content a page-scoped rule was meant to hide.
 * @param {string} selector
 */
export function startRecording(selector) {
  if (window.__rec) window.__rec.running = false;
  const html = document.documentElement;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const rec = (window.__rec = {
    running: true,
    selector,
    frames: 0,
    framesWithElement: 0,
    paintedFrames: 0,
    firstSeenAt: null,
    firstPaintedAt: null,
    finishAt: null,
    startAt: null,
    violations: [],
    states: [],
  });
  const pushState = () => {
    const s = [html.getAttribute('data-at-peace-page'), html.getAttribute('data-at-peace-next')];
    const last = rec.states[rec.states.length - 1];
    if (!last || last.page !== s[0] || last.next !== s[1]) rec.states.push({ t: now(), page: s[0], next: s[1] });
  };
  pushState();
  new MutationObserver(pushState).observe(html, { attributes: true, attributeFilter: ['data-at-peace-page', 'data-at-peace-next'] });
  window.addEventListener('yt-navigate-start', () => (rec.startAt = now()), true);
  window.addEventListener('yt-navigate-finish', () => (rec.finishAt = now()), true);

  const painted = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const tick = () => {
    if (!rec.running) return;
    rec.frames++;
    const els = document.querySelectorAll(rec.selector);
    if (els.length > 0) {
      rec.framesWithElement++;
      if (rec.firstSeenAt === null) rec.firstSeenAt = now();
      let n = 0;
      for (const el of els) if (painted(el)) n++;
      if (n > 0) {
        rec.paintedFrames++;
        if (rec.firstPaintedAt === null) rec.firstPaintedAt = now();
        if (rec.violations.length < 20) rec.violations.push({ t: now(), page: html.getAttribute('data-at-peace-page'), next: html.getAttribute('data-at-peace-next'), painted: n });
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Stops recording and returns what was seen. */
export function stopRecording() {
  const rec = window.__rec;
  if (!rec) return null;
  rec.running = false;
  return JSON.parse(JSON.stringify(rec));
}
