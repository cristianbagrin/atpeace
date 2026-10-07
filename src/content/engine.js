// Content-side engine (PLAN §7): site-agnostic. A site's main.js calls
//
//   AP.engine.start({ site, detectPage, features, navStartEvents, navEvents, targetUrl, bridge, dynamicCss })
//
// and the engine then
//   1. injects <style id="at-peace-style"> (compiled once from the schema) at document_start and
//      keeps it in the document,
//   2. mirrors the effective settings into `data-at-peace` (tokens that gate every rule) and
//      `data-at-peace-page` (current page type) on <html>, and into <style id="at-peace-dynamic">
//      (the elements the picker hid),
//   3. follows settings changes live (no reload),
//   4. follows SPA navigation and runs feature lifecycles with one shared mutation observer.
//
// Anti-flicker (both directions). YouTube fires `yt-navigate-start` (and calls history.pushState
// a few ms later) 0.1-1 s BEFORE the new page's elements exist, and keeps the OLD page on screen
// until it swaps them. Switching `data-at-peace-page` right then would stop hiding the old page
// (its hidden parts pop back into view: measured 8 painted frames), and switching only at
// `yt-navigate-finish` would let the new page paint unhidden. So at navigation start the TARGET
// page goes into `data-at-peace-next` while `data-at-peace-page` keeps the old one; page-scoped
// rules match either (see schema-core gate()). On `yt-navigate-finish` (or popstate, or after a
// 6 s safety timeout) `data-at-peace-page` becomes the page of location.href and `-next` is removed.
//
// Startup is deliberately cheap: one storage read, one stylesheet compile, no polling, and the
// mutation observer exists only while an enabled feature asks for it.
//
// FEATURE INTERFACE (all hooks optional, all wrapped in try/catch, async hooks may reject safely)
//   { id, settings: ['yt.watch.disableAutoplay', …], observes?: boolean, ignoresMaster?: boolean,
//     isActive?(ctx), init?(ctx), onSettings?(ctx, changedIds), onNavigate?(ctx),
//     onMutations?(ctx, addedRoots), destroy?(ctx) }
//   - Active = engine master switch on AND (isActive(ctx) if given, else any of `settings` is "on":
//     true, a non-zero number, a non-empty list, or a string other than show/allow/default/off/none).
//     `ignoresMaster: true` skips the master-switch condition: the master switch only governs how
//     YouTube looks/behaves, while Mindful Pause / Focus enforcement (session guard, time tracker)
//     must keep working when it is off — otherwise flipping it would escape a focus block.
//     It is re-evaluated after every settings change and every navigation.
//   - Becoming active: init(ctx), then onNavigate(ctx) (so the current page is handled by the same
//     code path), and, if `observes`, one onMutations(ctx, [documentElement]) for an initial scan.
//   - Settings change while active: onSettings(ctx, changedIdsThatBelongToTheFeature).
//   - Becoming inactive (setting off, master switch off): destroy(ctx). A feature whose init
//     throws is parked until the page reloads.
//   - onNavigate(ctx) runs for active features after each "done" navigation event
//     (yt-navigate-finish, yt-page-data-updated, popstate, pageshow); ctx.navEvent says which. It
//     is idempotent by contract: finish comes first, page-data-updated follows when the new page's
//     data has been applied, so DOM-dependent features should still tolerate a half-built page.
//   - onMutations(ctx, roots): elements added since the last animation frame, de-duplicated (a root
//     inside another root is dropped). Only features with `observes: true` are called.
//   ctx is ONE live object, updated in place: { site, settings, page, url, api, bridge, log, navEvent }.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { ATTR, MASTER_ID } = AP.schema;

  const STYLE_ID = 'at-peace-style';
  const DYNAMIC_ID = 'at-peace-dynamic';
  /** If a navigation never reports "done" (cancelled, failed), fall back to location after this long. */
  const RESYNC_MS = 6000;
  /** More pending mutation roots than this (hidden tab, huge page): rescan from the document root. */
  const MAX_PENDING_ROOTS = 1500;
  /** String values that mean "off" for the default feature-activity rule (PLAN §7.6). */
  const OFF_VALUES = new Set(['', 'show', 'allow', 'default', 'off', 'none']);

  // ---------------------------------------------------------------------------------------
  // Pure helpers (exported for tests)
  // ---------------------------------------------------------------------------------------

  /**
   * Is this setting value "on" for the default feature-activity rule? true; a non-zero number; a
   * non-empty array; a string other than show/allow/default/off/none. Objects are never "on".
   * @param {unknown} value
   * @returns {boolean}
   */
  function isOn(value) {
    if (value === true) return true;
    if (typeof value === 'number') return value !== 0 && Number.isFinite(value);
    if (typeof value === 'string') return !OFF_VALUES.has(value);
    if (Array.isArray(value)) return value.length > 0;
    return false;
  }

  /**
   * @param {{ settings?: string[], isActive?: (ctx: any) => boolean }} feature
   * @param {{ settings: Record<string, any> }} ctx
   * @returns {boolean}
   */
  function isFeatureActive(feature, ctx) {
    if (typeof feature.isActive === 'function') return Boolean(feature.isActive(ctx));
    return (feature.settings ?? []).some((id) => isOn(ctx.settings?.[id]));
  }

  /**
   * The dynamic stylesheet: picker rules (`advanced.customRules`, hidden under the master token
   * and optional page scope) and whatever a site adds through `extra(settings)`. Empty when the
   * master switch is off.
   * @param {Record<string, any>} settings effective settings
   * @param {{ site?: string, extra?: (settings: Record<string, any>) => string }} [options]
   * @returns {string}
   */
  function buildDynamicCss(settings, { site, extra } = {}) {
    if (!settings || settings[MASTER_ID] === false) return '';
    const parts = [];
    const rules = settings['advanced.customRules'];
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!AP.util.isPlainObject(rule) || !AP.schema.isSafeSelector(rule.selector)) continue;
      if (typeof rule.site === 'string' && rule.site !== '' && rule.site !== site) continue;
      const prefix = AP.schema.gate(MASTER_ID, typeof rule.page === 'string' && rule.page !== '' ? rule.page : null);
      for (const part of AP.schema.splitSelectorList(rule.selector)) parts.push(`${prefix} ${part} { display: none !important; }`);
    }
    if (typeof extra === 'function') {
      try {
        const more = extra(settings);
        if (typeof more === 'string' && more !== '') parts.push(more);
      } catch (err) {
        AP.warn('dynamicCss hook failed', err);
      }
    }
    return parts.join('\n');
  }

  /**
   * De-duplicates a batch of added nodes: disconnected nodes are dropped, and so is any node that
   * has an ancestor in the batch (the ancestor's scan covers it).
   * @param {Iterable<Node>} nodes
   * @returns {Node[]}
   */
  function collapseRoots(nodes) {
    const set = nodes instanceof Set ? nodes : new Set(nodes);
    const out = [];
    for (const node of set) {
      if (node.isConnected === false) continue;
      let covered = false;
      for (let p = node.parentNode; p; p = p.parentNode) {
        if (set.has(p)) {
          covered = true;
          break;
        }
      }
      if (!covered) out.push(node);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // The engine
  // ---------------------------------------------------------------------------------------

  /**
   * @typedef {Object} EngineConfig
   * @property {string} site                         site key ('youtube'): selects the compiled stylesheet
   * @property {(url: string) => string} detectPage  page type of a URL (pure)
   * @property {object[]} [features]                 feature objects (interface in the header)
   * @property {string[]} [navStartEvents]           events that announce a navigation to a NEW url (e.g. 'yt-navigate-start')
   * @property {string[]} [navEvents]                events after which location is authoritative (e.g. 'yt-navigate-finish')
   * @property {(event: Event) => string|null} [targetUrl]  target URL of a start event (may be a path); null if unreadable
   * @property {any} [bridge]                        site-specific page bridge handed to features as ctx.bridge
   * @property {(settings: Record<string, any>) => string} [dynamicCss]  extra dynamic CSS from settings
   * @property {{ doc: Document, win: Window, MutationObserver?: any, raf?: Function }} [env]  test-only injection
   */

  /** @param {EngineConfig} config */
  function createEngine(config) {
    const env = config.env ?? { doc: document, win: window };
    const { doc, win } = env;
    const ObserverClass = env.MutationObserver ?? globalThis.MutationObserver;
    const raf = env.raf ?? ((cb) => win.requestAnimationFrame(cb));
    const cancelRaf = env.cancelRaf ?? ((h) => win.cancelAnimationFrame?.(h));
    const site = config.site;
    const detectPage = config.detectPage ?? (() => 'other');

    const records = (config.features ?? []).map((feature) => ({ feature, active: false, broken: false, scan: false }));
    /** The one live context object handed to every feature. */
    const ctx = { site, settings: null, page: 'other', url: '', api: AP.api, bridge: config.bridge ?? null, log: AP.log, navEvent: null };

    let docEl = null;
    let styleEl = null;
    let dynamicEl = null;
    let guard = null; // keeps our <style> elements in the document
    let ruleCount = 0;
    let lastTokens = null;
    let lastDynamic = null;
    let attrPage = null;
    let nextPage = null;
    let resyncTimer = null;
    let unsubscribe = null;
    let observer = null;
    let rafHandle = null;
    let pending = new Set();
    let overflowed = false;
    let started = false;
    const listeners = []; // [target, type, handler, capture]

    const log = (...args) => AP.log('[engine]', ...args);

    // --- styles & attributes ------------------------------------------------------------

    function ensureStyle(id, css) {
      let el = doc.getElementById(id);
      if (!el) {
        el = doc.createElement('style');
        el.id = id;
      }
      if (el.textContent !== css) el.textContent = css;
      if (!el.isConnected) docEl.appendChild(el);
      return el;
    }

    function installStyles() {
      docEl = doc.documentElement;
      if (!docEl) {
        // Not expected at document_start; wait for the root rather than fail.
        const retry = () => {
          if (!doc.documentElement || styleEl) return;
          installStyles();
          syncFromLocation('init');
          if (ctx.settings) applySettings(ctx.settings, null);
        };
        addListener(doc, 'readystatechange', retry, false);
        addListener(doc, 'DOMContentLoaded', retry, false);
        return;
      }
      const rules = AP.schema.compileRules(site);
      ruleCount = rules.length;
      styleEl = ensureStyle(STYLE_ID, AP.schema.compileCss(site));
      styleEl.setAttribute('data-rules', String(ruleCount)); // lets tests compare with the parsed sheet
      dynamicEl = ensureStyle(DYNAMIC_ID, '');
      if (ObserverClass) {
        guard = new ObserverClass(() => {
          for (const el of [styleEl, dynamicEl]) if (el && !el.isConnected) docEl.appendChild(el);
        });
        guard.observe(docEl, { childList: true });
      }
    }

    function setPageAttr(page, source) {
      if (!docEl || page === attrPage) return;
      attrPage = page;
      docEl.setAttribute(ATTR.page, page);
      log('page attribute →', page, `(${source})`);
    }

    /** The page a navigation in flight leads to (null = none); see the anti-flicker note above. */
    function setNextAttr(page, source) {
      if (!docEl || page === nextPage) return;
      nextPage = page;
      if (page === null) docEl.removeAttribute(ATTR.next);
      else docEl.setAttribute(ATTR.next, page);
      log('next-page attribute →', page, `(${source})`);
    }

    function setTokens(tokens) {
      const value = tokens.join(' ');
      if (!docEl || value === lastTokens) return;
      lastTokens = value;
      docEl.setAttribute(ATTR.tokens, value);
    }

    function setDynamicCss(css) {
      if (!dynamicEl || css === lastDynamic) return;
      lastDynamic = css;
      dynamicEl.textContent = css;
    }

    // --- features ------------------------------------------------------------------------

    function report(rec, hook, err) {
      AP.warn(`feature "${rec.feature.id ?? '?'}" ${hook} failed`, err);
    }

    /** Calls a feature hook; false when it threw synchronously. Async rejections are logged. */
    function call(rec, hook, ...args) {
      const fn = rec.feature[hook];
      if (typeof fn !== 'function') return true;
      try {
        const result = fn.call(rec.feature, ctx, ...args);
        if (result && typeof result.then === 'function') result.then(undefined, (err) => report(rec, hook, err));
        return true;
      } catch (err) {
        report(rec, hook, err);
        return false;
      }
    }

    function wantsActive(rec) {
      if (ctx.settings?.[MASTER_ID] === false && rec.feature.ignoresMaster !== true) return false;
      try {
        return isFeatureActive(rec.feature, ctx);
      } catch (err) {
        report(rec, 'isActive', err);
        return false;
      }
    }

    /**
     * Starts/stops features to match the settings, and tells running ones what changed.
     * @param {string[]|null} changedIds settings that changed (null = none, e.g. after navigation)
     */
    function evaluateFeatures(changedIds) {
      for (const rec of records) {
        if (rec.broken) continue;
        const want = wantsActive(rec);
        if (want && !rec.active) {
          rec.active = true;
          if (!call(rec, 'init')) {
            rec.active = false;
            rec.broken = true;
            continue;
          }
          log('feature on:', rec.feature.id);
          call(rec, 'onNavigate');
          rec.scan = Boolean(rec.feature.observes);
        } else if (!want && rec.active) {
          rec.active = false;
          rec.scan = false;
          log('feature off:', rec.feature.id);
          call(rec, 'destroy');
        } else if (want && changedIds) {
          const own = rec.feature.settings;
          const relevant = Array.isArray(own) ? changedIds.filter((id) => own.includes(id)) : changedIds;
          if (relevant.length > 0) call(rec, 'onSettings', relevant);
        }
      }
      updateObserver();
    }

    // --- mutation bus --------------------------------------------------------------------

    function updateObserver() {
      const wanted = records.some((r) => r.active && r.feature.observes);
      if (wanted && !observer && ObserverClass) {
        observer = new ObserverClass(onMutations);
        observer.observe(doc, { childList: true, subtree: true });
        log('mutation observer on');
      } else if (!wanted && observer) {
        observer.disconnect();
        observer = null;
        pending = new Set();
        overflowed = false;
        if (rafHandle !== null) cancelRaf(rafHandle);
        rafHandle = null;
        log('mutation observer off');
      }
      if (wanted && records.some((r) => r.scan)) scheduleFlush();
    }

    function onMutations(mutations) {
      for (const m of mutations) {
        for (const node of m.addedNodes) if (node.nodeType === 1) pending.add(node);
      }
      if (pending.size > MAX_PENDING_ROOTS) {
        pending = new Set();
        overflowed = true;
      }
      scheduleFlush();
    }

    function scheduleFlush() {
      if (rafHandle === null) rafHandle = raf(flush);
    }

    function flush() {
      rafHandle = null;
      const batch = overflowed ? [docEl].filter(Boolean) : collapseRoots(pending);
      pending = new Set();
      overflowed = false;
      for (const rec of records) {
        if (!rec.active || !rec.feature.observes) continue;
        const roots = rec.scan ? [docEl] : batch; // first delivery after activation: the whole document
        rec.scan = false;
        if (roots.length > 0) call(rec, 'onMutations', roots);
      }
    }

    // --- settings ------------------------------------------------------------------------

    function applySettings(settings, changedIds) {
      ctx.settings = settings;
      setTokens(AP.schema.tokensFor(settings, site));
      setDynamicCss(buildDynamicCss(settings, { site, extra: config.dynamicCss }));
      evaluateFeatures(changedIds);
    }

    // --- navigation ----------------------------------------------------------------------

    function syncFromLocation(eventType) {
      ctx.url = win.location.href;
      ctx.page = detectPage(ctx.url);
      ctx.navEvent = eventType;
      setPageAttr(ctx.page, `location, ${eventType}`);
      setNextAttr(null, eventType);
    }

    /**
     * A navigation towards `url` has started: announce its page in `data-at-peace-next` (same-origin
     * URLs that lead somewhere else only; the committed page attribute is left alone).
     */
    function announceTarget(url, source) {
      let target;
      try {
        target = new URL(url, win.location.href);
      } catch {
        return;
      }
      // Same URL = not a navigation (YouTube replaceState()s the current URL right after start).
      if (target.origin !== win.location.origin || target.href === win.location.href) return;
      const page = detectPage(target.href);
      if (page === attrPage) return;
      setNextAttr(page, `early, ${source}`);
      armResync(); // whatever announced it, a navigation that never reports "done" must not leave this dangling
    }

    function armResync() {
      clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        syncFromLocation('resync');
      }, RESYNC_MS);
    }

    function onNavStart(event) {
      let target = null;
      try {
        target = config.targetUrl?.(event) ?? null;
      } catch {
        /* unreadable detail: the Navigation API / done events cover it */
      }
      if (target) announceTarget(target, 'nav-start detail');
      armResync(); // also when the target was unreadable: location is re-read if no "done" event follows
    }

    // Navigation API (Chromium, Firefox 147+): fires at history.pushState time with a plain-string
    // destination, so it works even where the page's event.detail is not readable from here.
    function onNavigateApi(event) {
      if (event.navigationType === 'reload' || event.hashChange) return;
      const url = event.destination?.url;
      if (typeof url === 'string') announceTarget(url, 'Navigation API');
    }

    function onNavDone(event) {
      clearTimeout(resyncTimer);
      resyncTimer = null;
      const before = new Set(records.filter((r) => r.active));
      syncFromLocation(event.type);
      evaluateFeatures(null); // page-conditional isActive()
      for (const rec of records) if (rec.active && before.has(rec)) call(rec, 'onNavigate');
    }

    // Options objects, not a bare boolean: identical in browsers, and Node's EventTarget (unit
    // tests) only matches `{ capture }` objects when removing.
    function addListener(target, type, handler, capture) {
      const options = { capture };
      target.addEventListener(type, handler, options);
      listeners.push([target, type, handler, options]);
    }

    // --- lifecycle -----------------------------------------------------------------------

    function begin() {
      started = true;
      // Kick the storage read off first so it overlaps with the style work below.
      const first = AP.settings.effective();
      installStyles();
      syncFromLocation('init');

      for (const type of config.navStartEvents ?? []) addListener(win, type, onNavStart, true);
      for (const type of config.navEvents ?? []) addListener(win, type, onNavDone, true);
      addListener(win, 'popstate', onNavDone, true);
      addListener(win, 'pageshow', (e) => e.persisted && onNavDone(e), true);
      if (win.navigation?.addEventListener) addListener(win.navigation, 'navigate', onNavigateApi, false);

      try {
        unsubscribe = AP.settings.subscribe((settings, changedIds) => applySettings(settings, changedIds), first);
      } catch (err) {
        AP.warn('could not watch settings changes', err); // e.g. the extension was reloaded under this page
      }
      first.then(
        (settings) => applySettings(settings, null),
        (err) => {
          AP.warn('could not read settings; using defaults', err);
          applySettings(AP.schema.defaults(), null);
        },
      );
    }

    function stop() {
      if (!started) return;
      started = false;
      for (const [target, type, handler, options] of listeners.splice(0)) target.removeEventListener(type, handler, options);
      unsubscribe?.();
      unsubscribe = null;
      clearTimeout(resyncTimer);
      observer?.disconnect();
      guard?.disconnect();
      observer = guard = null;
      if (rafHandle !== null) cancelRaf(rafHandle);
      rafHandle = null;
      for (const rec of records) {
        if (rec.active) {
          rec.active = false;
          call(rec, 'destroy');
        }
      }
      styleEl?.remove();
      dynamicEl?.remove();
      docEl?.removeAttribute(ATTR.tokens);
      docEl?.removeAttribute(ATTR.page);
      docEl?.removeAttribute(ATTR.next);
    }

    function inspect() {
      return {
        started,
        site,
        page: ctx.page,
        attrPage,
        nextPage,
        url: ctx.url,
        tokens: lastTokens ? lastTokens.split(' ') : [],
        dynamicCss: lastDynamic ?? '',
        ruleCount,
        observing: observer !== null,
        stylesConnected: Boolean(styleEl?.isConnected && dynamicEl?.isConnected),
        features: records.map((r) => ({ id: r.feature.id, active: r.active, broken: r.broken })),
      };
    }

    return { begin, stop, inspect, ctx };
  }

  /** @type {ReturnType<typeof createEngine>|null} */
  let current = null;

  /**
   * Starts the engine for a site. Calling it again replaces the previous instance.
   * @param {EngineConfig} config
   * @returns {{ stop: () => void, inspect: () => object, ctx: object }}
   */
  function start(config) {
    current?.stop();
    current = createEngine(config);
    current.begin();
    return current;
  }

  AP.engine = {
    start,
    /** Test hook: a snapshot of the running engine (tokens, page, features…), or null. */
    inspect: () => current?.inspect() ?? null,
    stop: () => {
      current?.stop();
      current = null;
    },
    isOn,
    isFeatureActive,
    buildDynamicCss,
    collapseRoots,
  };
})();
