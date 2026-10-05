// Element picker: the escape hatch for "hide anything" (PLAN §0 Declutter, §10 Phase 4).
//
//   AP.picker.start()   → { ok: true }   begin picking (the START_PICKER message does this too)
//   AP.picker.stop()                     leave, removing every listener, box and style it added
//   AP.picker.isActive()
//   AP.picker.selector                   the pure core (see below), unit-tested without a browser
//
// How it feels. Point at something on the page and click it: a box follows the pointer, YouTube's own
// hover and click handling is switched off. A small panel (bottom-right) says what will be hidden
// ("12 similar items on this page"), lets you walk to a bigger or smaller piece (Bigger/Smaller, or
// the arrow keys), choose where the rule applies (this kind of page / everywhere), and Hide (Enter)
// or Cancel (Esc). Hide appends a rule to `advanced.customRules`; the engine's dynamic stylesheet hides
// it at once, and the panel offers Undo for a few seconds before it goes away.
//
// How the selector is made (the core of this file; PLAN §6.2 is the rulebook):
//   * A "hook" is something YouTube keeps stable: a component tag (ytd-*, yt-*, ytm-*, ytw-*, tp-yt-*,
//     any other custom element), a stable id, a few whitelisted attributes (page-subtype, is-shorts,
//     target-id, section-identifier…, our own data-at-peace-* bridge tags), an href prefix on links
//     (/shorts/, /feed/x, /@…), and view-model class names (camelCase ytXxxViewModel…, ytp-*).
//     NEVER text, aria-labels, generated-looking ids (digits, hex, :r1:), style-scope, state classes.
//   * The element's own compound starts from its best hook and adds more hooks only while each one
//     narrows the matches on this page (so `ytd-rich-item-renderer`, but `…[is-slim-media]` where
//     that tells Shorts cards apart from the others).
//   * If the compound alone would also match things that are not "alike" (their parents are not the
//     same kind of container: a `ytd-button-renderer` is everywhere), up to two meaningful ancestors
//     are put in front of it (`#sponsor-button ytd-button-renderer`). A compound that is weak by
//     itself (a generic id such as #items) always gets an ancestor.
//   * `:nth-child()` exists only behind the explicit "Only this one" choice, and only when nothing
//     else tells the element apart.
//   * Refused, with a calm sentence: html, body, ytd-app, ytd-page-manager, #content, and any
//     selector that matches something covering more than 60% of the viewport (each side of the box
//     counts at most as much as the viewport's: see viewportShare).
// "Similar items" = everything the generated selector matches.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  // ===========================================================================================
  // Part 1. The selector core (no side effects; only reads the DOM it is handed)
  // ===========================================================================================

  const PROTECTED_TAGS = new Set(['html', 'body', 'ytd-app', 'ytd-page-manager']);
  const PROTECTED_IDS = new Set(['content', 'page-manager']);
  /** A matched element wider/taller than this share of the viewport (area) is refused. */
  const MAX_VIEWPORT_SHARE = 0.6;
  /** At most this many matches are inspected for size/protection/likeness (a runaway selector is refused anyway). */
  const MAX_INSPECT = 600;
  /** The most extra hooks one compound takes (a tag plus one or two more is already specific enough). */
  const MAX_EXTRAS = 2;

  /** Ids YouTube reuses in many components: weak on their own, always anchored. */
  const GENERIC_IDS = new Set([
    'content', 'contents', 'items', 'item', 'header', 'footer', 'title', 'text', 'info', 'meta', 'metadata', 'container', 'inner',
    'details', 'description', 'actions', 'action', 'buttons', 'button', 'menu', 'badges', 'thumbnail', 'overlays', 'overlay', 'body',
    'main', 'wrapper', 'dismissible', 'label', 'icon', 'image', 'img', 'link', 'list', 'panel', 'panels', 'section', 'sections',
    'row', 'rows', 'grid', 'primary', 'secondary', 'start', 'end', 'center', 'top', 'bottom', 'left', 'right', 'avatar', 'video-title',
    'channel-name', 'subtitle', 'owner', 'shelf', 'card', 'cards', 'root', 'page-manager',
  ]);

  /** Attributes whose value says what kind of thing an element is (never state). */
  const STABLE_ATTRS = [
    'page-subtype', 'is-shorts', 'is-slim-media', 'target-id', 'section-identifier', 'overlay-style', 'lockup',
    'data-at-peace-entry', 'data-at-peace-tab', 'data-at-peace-action',
  ];

  /** Link prefixes worth selecting on (first match wins; `/feed/x` is cut to its first two segments). */
  const HREF_PREFIXES = ['/shorts/', '/feed/', '/@', '/playlist', '/hashtag/', '/channel/', '/results', '/watch', '/live/', '/premium', '/gaming', '/podcasts', '/post/', '/c/', '/user/'];

  /** Tags that are plumbing or decoration, never something to hide on their own. */
  const INFRA_TAG = /^(?:dom-|ps-dom-|iron-|custom-style$|template$)/;
  const SVG_RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);
  /** Pictures and the like: the thing around them is what a person means to hide. */
  const MEDIA_TAGS = new Set(['img', 'picture', 'svg', 'path', 'use', 'video', 'canvas', 'source']);
  const LEAF_TAGS = new Set([
    'yt-icon', 'yt-icon-shape', 'yt-touch-feedback-shape', 'yt-interaction', 'yt-formatted-string', 'yt-attributed-string', 'tp-yt-paper-tooltip',
    'yt-tooltip', 'yt-animated-icon', 'yt-img-shadow-container',
  ]);

  const COMPONENT_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
  const ID_OK = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
  const CLASS_VIEW_MODEL = /^(?:yt[A-Z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*ViewModel[A-Za-z0-9]*)$/;
  const CLASS_PLAYER = /^ytp-[a-z][a-z0-9-]*$/;
  // State (changes while you look), and presentation helpers (how it is laid out, not what it is).
  const CLASS_STATE = /(?:-mode|-hover|-active|-visible|-hidden|-open|-opened|-closed|-expanded|-collapsed|-focused|-selected|-playing|-paused|-ended|-buffering|-autohide|-enabled|-disabled|-loading|-shown|(?:Loaded|Loading|Hidden|Visible|Active|Selected|Expanded|Collapsed|Open|Focused|Hover|Playing|Paused|Disabled|Enabled|Dark|Light|Mode|Hovered|Pressed))$|^ytp-(?:hide|show|autohide|fullscreen|big|small|large|hover|menu-shown)/;
  const CLASS_PRESENTATION = /(?:WhiteSpace|Ellipsis|Truncate|ContentMode|FillParent|Align|Flex|Margin|Padding|Width|Height|Wrap|Clip|Overflow|Color|Rounded|Border|Shadow|Gradient|Spacing|Size[A-Z]|Fit|Imation|Animation|Transition|Ripple|Interaction|TouchResponse)/;
  const VARIANT_WORD = /(?:Vertical|Horizontal|Compact|Large|Small|Medium|Has[A-Z]|Is[A-Z]|With|Without|Dark|Light|Hover|Active)/;

  /** True when an id looks machine-made (digits, hex, UUIDs, `:r1:`, random mixed-case tokens): never stable. */
  function looksGeneratedId(id) {
    if (typeof id !== 'string' || id === '' || id.length > 63) return true;
    if (id.startsWith(':') || /^\d/.test(id)) return true; // React/Polymer-style, or not even a valid identifier start
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return true; // anything that would need escaping
    if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return true; // UUID
    if (/(?:^|[-_])[0-9a-f]{8,}(?:$|[-_])/i.test(id)) return true; // long hex segment
    const digits = (id.match(/\d/g) ?? []).length;
    if (digits >= 4 || (id.length >= 5 && digits / id.length > 0.3)) return true; // digits-heavy
    if (/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9_-]{8,}$/.test(id)) return true; // random token
    return false;
  }

  /** @param {string} id */
  const isStableId = (id) => !looksGeneratedId(id) && ID_OK.test(id);

  /**
   * A class worth selecting on: YouTube's view-model names (ytLockupViewModelHost,
   * shortsLockupViewModelHost…) and the player's ytp-* BEM names. Never style-scope / ytd-*
   * scope markers, utility classes, state words or anything with a hash in it.
   * @param {string} name
   */
  function isStableClass(name) {
    if (typeof name !== 'string' || name.length < 4 || name.length > 80) return false;
    if (CLASS_STATE.test(name) || CLASS_PRESENTATION.test(name)) return false;
    if (/\d{3,}/.test(name)) return false;
    return CLASS_VIEW_MODEL.test(name) || CLASS_PLAYER.test(name);
  }

  /** @param {string} tag lower-case local name */
  function isComponentTag(tag) {
    return typeof tag === 'string' && COMPONENT_TAG.test(tag) && !INFRA_TAG.test(tag) && !SVG_RESERVED.has(tag);
  }

  const attrValueOk = (v) => typeof v === 'string' && v.length <= 80 && !v.includes('"') && !v.includes('\\') && ![...v].some((c) => c.charCodeAt(0) < 32);

  /** `/shorts/dQw…` → `/shorts/`; `/feed/subscriptions?x` → `/feed/subscriptions`; null when no known prefix applies. */
  function hrefPrefix(href) {
    if (typeof href !== 'string') return null;
    let path = href;
    if (/^https?:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
        path = url.pathname;
      } catch {
        return null;
      }
    }
    path = path.split(/[?#]/)[0];
    const hit = HREF_PREFIXES.find((p) => path.startsWith(p));
    if (!hit) return null;
    if (hit === '/feed/') {
      const seg = path.split('/')[2];
      return seg && /^[a-z]+$/i.test(seg) ? `/feed/${seg}` : null;
    }
    return hit;
  }

  /**
   * What an element offers to select on.
   * @param {Element} el
   * @returns {{ el: Element, tag: string, comp: boolean, leaf: boolean, id: string|null, attrs: string[], classes: string[] }}
   */
  function describe(el) {
    const tag = String(el.localName ?? '').toLowerCase();
    const comp = isComponentTag(tag);
    const rawId = el.getAttribute('id');
    const attrs = [];
    for (const name of STABLE_ATTRS) {
      const v = el.getAttribute(name);
      if (v === null) continue;
      if (v === '') attrs.push(`[${name}]`);
      else if (attrValueOk(v)) attrs.push(`[${name}="${v}"]`);
    }
    const prefix = tag === 'a' ? hrefPrefix(el.getAttribute('href')) : null;
    if (prefix && attrValueOk(prefix)) attrs.push(`[href^="${prefix}"]`);
    const classes = String(el.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(isStableClass)
      .filter((c, i, all) => all.indexOf(c) === i)
      .sort((a, b) => Number(VARIANT_WORD.test(a)) - Number(VARIANT_WORD.test(b))); // stable sort: DOM order within each group
    return {
      el,
      tag,
      comp,
      leaf: (comp && LEAF_TAGS.has(tag)) || MEDIA_TAGS.has(tag),
      id: rawId && isStableId(rawId) ? rawId : null,
      attrs,
      classes,
    };
  }

  /** Has at least one thing to select on. */
  const hasHook = (d) => !d.leaf && (d.comp || d.id !== null || d.classes.length > 0 || d.attrs.length > 0);

  /** html / body / ytd-app / ytd-page-manager / #content: never hidden. */
  function isProtectedElement(el) {
    const tag = String(el.localName ?? '').toLowerCase();
    if (PROTECTED_TAGS.has(tag)) return true;
    const id = el.getAttribute('id');
    return id !== null && PROTECTED_IDS.has(id);
  }

  /** The best single hook of an element, as selector text: tag, else #id, else .class, else tag[attr]. */
  function primaryOf(d) {
    if (d.comp) return { text: d.tag, kind: 'tag' };
    if (d.id) return { text: `#${d.id}`, kind: 'id' };
    if (d.classes.length > 0) return { text: `.${d.classes[0]}`, kind: 'class' };
    if (d.attrs.length > 0) return { text: `${d.tag}${d.attrs[0]}`, kind: 'attr' };
    return null;
  }

  /** Which extras (more hooks) an element could add after its primary, in order of preference. */
  function extrasOf(d, primary) {
    const out = [];
    for (const a of d.attrs) if (!primary.text.includes(a)) out.push(a);
    if (d.id && primary.kind !== 'id') out.push(`#${d.id}`);
    for (const c of d.classes) if (!(primary.kind === 'class' && primary.text === `.${c}`)) out.push(`.${c}`);
    return out;
  }

  /** Short human text for what a rule hides ("ytd-merch-shelf-renderer", "#related"). */
  function labelOf(el) {
    const p = primaryOf(describe(el));
    return p ? p.text : String(el.localName ?? 'element');
  }

  const PAGE_FOR_NOTE = {
    home: 'the home page', watch: 'watch pages', search: 'search pages', shorts: 'Shorts pages', subscriptions: 'the Subscriptions page',
    channel: 'channel pages', playlist: 'playlist pages', history: 'the History page', you: 'the You page', hashtag: 'hashtag pages',
    other: 'this kind of page',
  };

  /**
   * The auto-written description stored with a rule.
   * @param {string} label e.g. "ytd-merch-shelf-renderer"
   * @param {string|null} page
   */
  const noteFor = (label, page) => `Hid ${label}${page ? ` on ${PAGE_FOR_NOTE[page] ?? `${page} pages`}` : ''}`.slice(0, 200);

  // --- selectors as text (used by the generator and, in spirit, by the options form) ----------

  /** Last compound of a complex selector ("a > b.c" → "b.c"), ignoring combinators inside () and []. */
  function lastCompound(part) {
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\\') {
        i++;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\t' || ch === '\n')) {
        start = i + 1;
      }
    }
    return part.slice(start).trim();
  }

  /**
   * Static check for a typed-in selector: the same refusals the picker applies to what it builds,
   * minus the viewport share (which needs a page). Returns a calm sentence, or null when fine.
   * @param {string} selector one complex selector (no top-level commas)
   * @returns {string|null}
   */
  function refuseSelectorText(selector) {
    const compound = lastCompound(String(selector).trim());
    if (compound === '') return 'That is not a selector.';
    const head = (compound.match(/^(?:\*|[a-zA-Z][a-zA-Z0-9-]*)/)?.[0] ?? '').toLowerCase();
    if (compound === ':root' || compound.startsWith(':root') || PROTECTED_TAGS.has(head) || /^#(?:content|page-manager)(?![\w-])/.test(compound)) {
      return 'That is the page itself, so it is left alone. Pick something inside it.';
    }
    const withoutArgs = compound.replace(/\([^)]*\)/g, '');
    const generic = !/[#.[]/.test(withoutArgs) && !head.includes('-');
    if (generic) return 'That would match far too much (every plain element of that kind). Add a class, an id or a component name.';
    return null;
  }

  // --- generation -----------------------------------------------------------------------------

  /**
   * @typedef {Object} Generated
   * @property {true} ok
   * @property {string} selector
   * @property {number} count          every match on this page, hidden ones included
   * @property {number} visible        matches that are on screen now
   * @property {boolean} similar       the selector matches more than the picked element
   * @property {boolean} unique        built with :nth-child to match only the picked element
   * @property {Element[]} matches     the matched elements (at most MAX_INSPECT)
   * @property {string} label          what to call it ("ytd-merch-shelf-renderer")
   */
  /** @typedef {{ ok: false, reason: 'protected'|'too-big'|'no-hook'|'unstable', message: string }} Refused */

  const REFUSALS = {
    protected: 'That is the page itself, not something on it. Try pointing at something smaller.',
    'too-big': 'That is most of the page, so hiding it would leave nothing. Try something smaller.',
    'no-hook': 'I cannot find a steady way to pick that one. Try a bigger or smaller piece.',
    unstable: 'There is no steady way to tell that one apart from its neighbours.',
  };
  const refuse = (reason) => ({ ok: false, reason, message: REFUSALS[reason] });

  const viewportOf = (doc, override) => {
    if (override) return override;
    const win = doc.defaultView;
    return { width: win?.innerWidth ?? 1280, height: win?.innerHeight ?? 800 };
  };

  const queryAll = (doc, selector) => {
    try {
      return Array.from(doc.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  /** How a container is called when comparing neighbours: its best hook, or its tag. */
  function signatureOf(el) {
    if (!el) return '';
    const p = primaryOf(describe(el));
    return p ? p.text : String(el.localName ?? '');
  }

  /** Every match sits in the same kind of container as the target does. */
  function areAlike(matches, target) {
    if (matches.length > MAX_INSPECT) return false;
    const want = signatureOf(target.parentElement);
    return matches.every((m) => signatureOf(m.parentElement) === want);
  }

  /**
   * The element's own compound: its best hook plus the extra hooks that narrow the page's matches.
   * @returns {{ text: string, strong: boolean, primary: string, kind: string } | null}
   */
  function ownCompound(d, doc) {
    const primary = primaryOf(d);
    if (!primary) return null;
    let text = primary.text;
    let count = queryAll(doc, text).length;
    let used = 0;
    for (const extra of extrasOf(d, primary)) {
      if (used >= MAX_EXTRAS) break;
      const next = `${text}${extra}`;
      const c = queryAll(doc, next).length;
      if (c > 0 && c < count) {
        text = next;
        count = c;
        used++;
      }
    }
    // An id alone is only a good hook when YouTube does not reuse it for other things.
    const strong = primary.kind !== 'id' || (!GENERIC_IDS.has(d.id) && queryAll(doc, `#${d.id}`).length === 1);
    return { text, strong, primary: primary.text, kind: primary.kind };
  }

  /** How an ancestor is written when it is used as context: component tag (+ kind-of attributes), unique id, or class. */
  function anchorText(d, doc) {
    if (d.leaf) return null;
    if (d.comp) {
      const kindAttrs = d.attrs.filter((a) => /^\[(?:page-subtype|target-id|section-identifier|is-shorts)/.test(a));
      return `${d.tag}${kindAttrs.join('')}`;
    }
    if (d.id && !GENERIC_IDS.has(d.id) && queryAll(doc, `#${d.id}`).length === 1) return `#${d.id}`;
    if (d.classes.length > 0) return `.${d.classes[0]}`;
    return null;
  }

  /** Up to two meaningful ancestors, nearest first. Never climbs into the page frame. */
  function collectAnchors(target, doc) {
    const out = [];
    for (let e = target.parentElement; e && out.length < 2; e = e.parentElement) {
      if (isProtectedElement(e)) break;
      const text = anchorText(describe(e), doc);
      if (text) out.push(text);
    }
    return out;
  }

  /** Index of `el` among its parent's element children (1-based), for :nth-child. */
  function childIndex(el) {
    const parent = el.parentElement;
    if (!parent) return 0;
    const kids = Array.from(parent.children);
    return kids.indexOf(el) + 1;
  }

  /**
   * A selector for the picked element.
   * @param {Element} target
   * @param {{ doc?: Document, viewport?: { width: number, height: number }, unique?: boolean }} [options]
   *   `unique`: match only this element (position-based when nothing else tells it apart)
   * @returns {Generated | Refused}
   */
  function generate(target, options = {}) {
    const doc = options.doc ?? target.ownerDocument;
    if (!target || target.nodeType !== 1) return refuse('no-hook');
    if (isProtectedElement(target)) return refuse('protected');
    const d = describe(target);
    if (!hasHook(d)) return refuse('no-hook');
    const own = ownCompound(d, doc);
    if (!own) return refuse('no-hook');

    const anchors = collectAnchors(target, doc);
    /** @type {string[]} */
    const candidates = [];
    if (own.strong) candidates.push(own.text);
    if (anchors[0]) candidates.push(`${anchors[0]} ${own.text}`);
    if (anchors[1]) candidates.push(`${anchors[1]} ${anchors[0]} ${own.text}`);
    if (candidates.length === 0) return refuse('no-hook');

    let chosen = null;
    let unique = false;
    if (options.unique) {
      for (const cand of candidates) {
        if (queryAll(doc, cand).length === 1) {
          chosen = { selector: cand, matches: queryAll(doc, cand) };
          break;
        }
      }
      if (!chosen) {
        const nth = childIndex(target);
        for (const cand of candidates) {
          if (nth === 0) break;
          const selector = `${cand}:nth-child(${nth})`;
          const matches = queryAll(doc, selector);
          if (matches.length === 1 && matches[0] === target) {
            chosen = { selector, matches };
            unique = true;
            break;
          }
        }
      }
      if (!chosen) return refuse('unstable');
    } else {
      const tried = [];
      for (const cand of candidates) {
        const matches = queryAll(doc, cand);
        if (!matches.includes(target)) continue;
        tried.push({ selector: cand, matches });
        if (matches.length === 1 || areAlike(matches, target)) {
          chosen = tried[tried.length - 1];
          break;
        }
      }
      // Nothing was alike even with two ancestors: take the tightest.
      chosen ??= tried.sort((a, b) => a.matches.length - b.matches.length || a.selector.length - b.selector.length)[0];
      if (!chosen) return refuse('no-hook');
    }

    // Size and protection: every match, not only the picked one.
    const view = viewportOf(doc, options.viewport);
    for (const m of chosen.matches.slice(0, MAX_INSPECT)) {
      if (isProtectedElement(m)) return refuse('protected');
      if (viewportShare(m.getBoundingClientRect(), view) > MAX_VIEWPORT_SHARE) return refuse('too-big');
    }
    if (chosen.matches.length > MAX_INSPECT) return refuse('too-big');
    if (!AP.schema.isSafeSelector(chosen.selector)) return refuse('no-hook');

    const visible = chosen.matches.filter((m) => m.getClientRects().length > 0).length;
    return {
      ok: true,
      selector: chosen.selector,
      count: chosen.matches.length,
      visible,
      similar: chosen.matches.length > 1,
      unique,
      matches: chosen.matches,
      label: own.primary,
    };
  }

  /**
   * How much of the viewport a box could cover: each side counts at most as much as the viewport's
   * own, so a long column is measured by what shows of it (a 400px-wide related list is 31% of a
   * 1280px window however far it scrolls; the 850px-wide main column is 66%).
   */
  function viewportShare(rect, view) {
    if (!(view.width > 0 && view.height > 0)) return 0;
    return Math.min(1, rect.width / view.width) * Math.min(1, rect.height / view.height);
  }

  /** Cheap per-element version of the size check, for the hover highlight. */
  const isOversized = (el, view) => viewportShare(el.getBoundingClientRect(), view) > MAX_VIEWPORT_SHARE;

  /**
   * The elements "Bigger" walks through, starting from what the pointer is over: the first one with
   * a hook, then only component tags and unique ids (so one click goes from a title to its card, not
   * through ten anonymous wrappers). A wrapper whose box is identical to the previous step replaces
   * it (hiding the outer one leaves no empty shell). Stops below the page frame.
   * @param {Element} hit
   * @param {Document} doc
   * @returns {{ chain: ReturnType<typeof describe>[], stoppedAtFrame: boolean }}
   */
  function buildChain(hit, doc) {
    const chain = [];
    let stoppedAtFrame = false;
    for (let e = hit; e && e !== doc.documentElement; e = e.parentElement) {
      if (isProtectedElement(e)) {
        stoppedAtFrame = true;
        break;
      }
      const d = describe(e);
      if (!hasHook(d)) continue;
      if (chain.length > 0) {
        const waypoint = d.comp || (d.id !== null && !GENERIC_IDS.has(d.id) && queryAll(doc, `#${d.id}`).length === 1);
        if (!waypoint) continue;
        if (sameBox(chain[chain.length - 1].el, e)) {
          chain[chain.length - 1] = d;
          continue;
        }
      }
      chain.push(d);
    }
    return { chain, stoppedAtFrame };
  }

  function sameBox(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (ra.width === 0 && ra.height === 0) return false;
    return Math.abs(ra.left - rb.left) < 1.5 && Math.abs(ra.top - rb.top) < 1.5 && Math.abs(ra.width - rb.width) < 1.5 && Math.abs(ra.height - rb.height) < 1.5;
  }

  const core = {
    generate,
    buildChain,
    describe,
    hasHook,
    looksGeneratedId,
    isStableId,
    isStableClass,
    isComponentTag,
    hrefPrefix,
    isProtectedElement,
    viewportShare,
    refuseSelectorText,
    lastCompound,
    labelOf,
    noteFor,
    MAX_VIEWPORT_SHARE,
  };

  // ===========================================================================================
  // Part 2. The picking session (page listeners, highlight boxes, the panel)
  // ===========================================================================================

  const HOST_ATTR = 'data-at-peace-picker';
  const UNDO_MS = 6000;
  const MAX_SIMILAR_BOXES = 80;
  const MAX_RULES = 500;

  const PALETTE_LIGHT = '--paper:#F3EEE3;--paper-2:#EAE2D1;--ink:#1B2050;--ink-2:#5E5A55;--rule:#B9C4D3;--edge:#757A8A;--clay:#8E7266;--seal:#E5600F;--danger:#B3412F;';
  const PALETTE_DARK = '--paper:#14162B;--paper-2:#1C1F3A;--ink:#E9E3D6;--ink-2:#A8A3B8;--rule:#33385C;--edge:#6F74A0;--clay:#B79E91;--seal:#F47A2E;--danger:#E07A68;';

  const CSS = `
:host { all: initial; }
.layer { ${PALETTE_LIGHT} position: fixed; inset: 0; pointer-events: none; }
.layer[data-theme="dark"] { ${PALETTE_DARK} }
@media (prefers-color-scheme: dark) { .layer[data-theme="system"] { ${PALETTE_DARK} } }
.box { position: fixed; box-sizing: border-box; pointer-events: none; display: none; border-radius: 2px; }
.box.target { outline: 2px solid var(--seal); outline-offset: -1px; background: color-mix(in srgb, var(--seal) 14%, transparent); }
.box.target.refused { outline: 2px dashed var(--ink-2); background: color-mix(in srgb, var(--ink-2) 12%, transparent); }
.box.similar { outline: 1.5px dashed var(--seal); outline-offset: -1px; opacity: 0.75; }
.panel {
  position: fixed; right: 16px; bottom: 16px; width: 332px; max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 14px; background: var(--paper); color: var(--ink); border: 1px solid var(--edge); border-radius: 3px;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; -webkit-font-smoothing: antialiased;
  pointer-events: auto; text-align: left;
}
.panel[data-side="left"] { right: auto; left: 16px; }
.panel, .panel * { cursor: default; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font: 600 15px/1.2 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif; letter-spacing: 0.02em; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--seal); flex: none; }
p { margin: 0; }
.hint, .count, .note, .fine { color: var(--ink-2); }
.count { color: var(--ink); font-weight: 600; }
.note { margin-top: 7px; }
.note.is-problem { color: var(--danger); }
.fine { font-size: 12.5px; margin-top: 4px; }
code.sel { display: block; margin: 7px 0 3px; padding: 5px 7px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12.5px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; align-items: center; }
fieldset { border: 0; margin: 11px 0 0; padding: 0; min-width: 0; }
legend { padding: 0; margin: 0 0 4px; color: var(--ink-2); font-size: 12.5px; }
.choice { display: flex; gap: 7px; align-items: flex-start; margin-top: 4px; cursor: pointer; }
button {
  font: inherit; font-size: 13.5px; min-height: 32px; padding: 4px 12px; border-radius: 3px;
  border: 1px solid var(--edge); background: transparent; color: var(--ink);
}
button, .choice, label.check { cursor: pointer !important; }
button:disabled { cursor: default !important; }
button:hover:not(:disabled) { background: var(--paper-2); border-color: var(--ink); }
button.primary { background: var(--ink); border-color: var(--ink); color: var(--paper); }
button.primary:hover:not(:disabled) { background: var(--ink); opacity: 0.88; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
button .key { margin-left: 6px; color: var(--ink-2); font-size: 12px; }
button.primary .key { color: inherit; opacity: 0.75; }
.choice button { all: unset; display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
.radio { flex: none; width: 14px; height: 14px; margin-top: 3px; box-sizing: border-box; border: 1.5px solid var(--edge); border-radius: 50%; }
.choice[aria-checked="true"] .radio { border-color: var(--ink); background: radial-gradient(circle, var(--ink) 0 38%, transparent 42%); }
.choice:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
label.check { display: flex; gap: 7px; align-items: center; margin-top: 9px; cursor: pointer; }
.bar { height: 2px; margin-top: 9px; background: var(--rule); }
.bar > i { display: block; height: 100%; width: 100%; background: var(--seal); transform-origin: left; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

  /** The one running session, or null. */
  let session = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function adoptStyles(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      /* constructed sheets unavailable: fall through to a <style> element */
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
  }

  const currentPage = () => {
    try {
      return AP.yt?.page?.detect(location.href) ?? 'other';
    } catch {
      return 'other';
    }
  };

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  function place(box, rect) {
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  /** Events that must never reach YouTube while picking; the ones that act are handled in `onClick`/`onKey`. */
  const POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart', 'selectstart', 'touchstart', 'touchend'];
  const HOVER_EVENTS = ['pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'];
  const MOVE_EVENTS = ['pointermove', 'mousemove'];
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  /**
   * Begins picking. Safe to call while already picking (nothing changes).
   * @returns {{ ok: boolean, error?: string, already?: boolean }}
   */
  function start() {
    if (session) return { ok: true, already: true };
    if (typeof document === 'undefined' || !document.documentElement || !document.body) return { ok: false, error: 'no-document' };
    try {
      session = createSession();
      return { ok: true };
    } catch (err) {
      AP.warn('picker could not start', err);
      stop();
      return { ok: false, error: 'failed' };
    }
  }

  /** Leaves picking and removes everything this session added. */
  function stop() {
    const s = session;
    session = null;
    s?.destroy();
  }

  function createSession() {
    const doc = document;
    const root = doc.documentElement;

    // --- UI --------------------------------------------------------------------------------
    const host = doc.createElement('div');
    host.setAttribute(HOST_ATTR, 'pick');
    for (const [prop, value] of [['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'], ['display', 'block'], ['pointer-events', 'none']]) {
      host.style.setProperty(prop, value, 'important');
    }
    const shadow = host.attachShadow({ mode: 'closed' });
    adoptStyles(shadow);

    const layer = el('div', 'layer');
    const targetBox = el('div', 'box target');
    layer.append(targetBox);
    const panel = el('section', 'panel');
    layer.dataset.theme = 'light';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Hide an element');
    const head = el('div', 'head');
    head.append(el('span', 'dot'), el('span', '', 'Hide an element'));
    const body = el('div', 'body');
    panel.append(head, body);
    layer.append(panel);
    shadow.append(layer);

    const state = {
      phase: 'pick', // 'pick' | 'review' | 'done'
      hover: null, // the chain entry the pointer is over (pick phase)
      hoverRefused: false,
      chain: [],
      stoppedAtFrame: false,
      index: 0,
      only: false,
      scope: 'page',
      page: currentPage(),
      message: '', // calm problem text for the review phase
      cache: new Map(),
      saved: null, // { rule, ... } in the done phase
      pointer: null,
      timers: new Set(),
      raf: 0,
      busy: false,
      doneText: '',
    };
    const removers = [];
    const similarBoxes = [];
    let cursorStyle = null;

    const later = (fn, ms) => {
      const id = setTimeout(() => {
        state.timers.delete(id);
        try {
          fn();
        } catch (err) {
          AP.warn('picker timer failed', err);
        }
      }, ms);
      state.timers.add(id);
      return id;
    };

    // --- evaluation of the current choice ---------------------------------------------------
    const entry = () => state.chain[state.index] ?? null;
    function evaluate(index = state.index) {
      const e = state.chain[index];
      if (!e) return null;
      const key = `${index}:${state.only ? 1 : 0}`;
      if (!state.cache.has(key)) state.cache.set(key, generate(e.el, { doc, viewport: viewport(), unique: state.only }));
      return state.cache.get(key);
    }

    // --- layout ----------------------------------------------------------------------------
    const syncSimilar = (matches, target) => {
      const shown = [];
      if (matches) {
        const view = viewport();
        for (const m of matches) {
          if (shown.length >= MAX_SIMILAR_BOXES) break;
          if (m === target) continue;
          const r = m.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > view.height || r.right < 0 || r.left > view.width) continue;
          shown.push(r);
        }
      }
      while (similarBoxes.length < shown.length) {
        const box = el('div', 'box similar');
        layer.insertBefore(box, panel);
        similarBoxes.push(box);
      }
      similarBoxes.forEach((box, i) => place(box, shown[i]));
    };

    function layout() {
      state.raf = 0;
      let focusEl = null;
      let matches = null;
      let refused = false;
      if (state.phase === 'pick') {
        focusEl = state.hover?.el ?? null;
        refused = state.hoverRefused;
      } else if (state.phase === 'review') {
        focusEl = entry()?.el ?? null;
        const res = evaluate();
        refused = !res || res.ok === false;
        matches = res?.ok ? res.matches : null;
      }
      if (focusEl && !focusEl.isConnected) focusEl = null;
      const rect = focusEl ? focusEl.getBoundingClientRect() : null;
      place(targetBox, rect);
      targetBox.classList.toggle('refused', refused);
      syncSimilar(matches, focusEl);

      // Keep the panel out of the way of what is being looked at.
      if (rect && state.phase !== 'done') {
        const p = panel.getBoundingClientRect();
        const overlaps = !(rect.right < p.left || rect.left > p.right || rect.bottom < p.top || rect.top > p.bottom);
        if (overlaps) {
          const flipped = panel.dataset.side !== 'left';
          panel.dataset.side = flipped ? 'left' : 'right';
          const q = panel.getBoundingClientRect();
          // If the other corner is no better, go back.
          const still = !(rect.right < q.left || rect.left > q.right || rect.bottom < q.top || rect.top > q.bottom);
          if (still) panel.dataset.side = flipped ? 'right' : 'left';
        }
      }
    }
    const scheduleLayout = () => {
      if (!state.raf) state.raf = requestAnimationFrame(layout);
    };

    // --- panel ----------------------------------------------------------------------------
    const button = (label, { primary = false, key = '', onClick, disabled = false, title = '' } = {}) => {
      const b = el('button', primary ? 'primary' : '', label);
      b.type = 'button';
      if (key) b.append(el('span', 'key', key));
      if (title) b.title = title;
      b.disabled = disabled;
      b.addEventListener('click', () => {
        try {
          const out = onClick();
          if (out && typeof out.then === 'function') out.then(undefined, (err) => AP.warn('picker action failed', err));
        } catch (err) {
          AP.warn('picker action failed', err);
        }
      });
      return b;
    };

    const pageName = () => state.page;

    function renderPick() {
      const hint = el('p', 'hint', 'Point at something and click it.');
      hint.setAttribute('role', 'status');
      const row = el('div', 'row');
      row.append(button('Cancel', { key: 'Esc', onClick: stop }));
      body.replaceChildren(hint, row);
    }

    function renderReview() {
      const res = evaluate();
      const frag = [];
      const live = el('div');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');

      if (!res || res.ok === false) {
        const text = res?.message ?? (state.stoppedAtFrame ? 'That is the page itself, not something on it. Try pointing at something smaller.' : 'I cannot find a steady way to pick that one. Try pointing at something else.');
        live.append(el('p', 'note is-problem', text));
        frag.push(live);
      } else {
        live.append(el('p', 'count', res.unique ? 'Just this one.' : res.similar ? `${res.visible || res.count} similar items on this page` : 'Just this one on this page'));
        const sel = el('code', 'sel', res.selector);
        sel.title = res.selector;
        frag.push(live, sel);
        if (res.unique) frag.push(el('p', 'fine', 'This uses its position, so it can stop working if YouTube reorders things.'));
      }
      if (state.message) {
        const p = el('p', 'note', state.message);
        live.append(p);
      }

      const nextRes = state.index + 1 < state.chain.length ? evaluate(state.index + 1) : null;
      const canBigger = Boolean(nextRes?.ok);
      const steps = el('div', 'row');
      steps.append(
        button('Smaller', { key: '↓', disabled: state.index === 0, onClick: () => step(-1), title: 'A smaller piece (arrow down)' }),
        button('Bigger', { key: '↑', disabled: !canBigger, onClick: () => step(1), title: 'A bigger piece (arrow up)' }),
      );
      frag.push(steps);

      if (res?.ok && (res.similar || state.only)) {
        const label = el('label', 'check');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = state.only;
        box.addEventListener('change', () => {
          state.only = box.checked;
          state.message = '';
          if (state.only && evaluate()?.ok === false) {
            state.only = false;
            state.message = REFUSALS.unstable;
          }
          render();
        });
        label.append(box, el('span', '', 'Only this one'));
        frag.push(label);
      }

      const scope = el('fieldset');
      scope.setAttribute('role', 'radiogroup');
      scope.append(el('legend', '', 'Hide it on'));
      for (const [value, text] of [['page', `This kind of page (${pageName()})`], ['all', 'Everywhere']]) {
        const choice = el('div', 'choice');
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(state.scope === value));
        choice.tabIndex = 0;
        choice.append(el('span', 'radio'), el('span', '', text));
        const pick = () => {
          state.scope = value;
          render();
        };
        choice.addEventListener('click', pick);
        choice.addEventListener('keydown', (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            pick();
          }
        });
        scope.append(choice);
      }
      frag.push(scope);

      const actions = el('div', 'row');
      actions.append(
        button('Hide', { primary: true, key: '⏎', disabled: !res?.ok || state.busy, onClick: commit }),
        button('Cancel', { key: 'Esc', onClick: stop }),
      );
      frag.push(actions);
      body.replaceChildren(...frag);
    }

    function renderDone() {
      const live = el('div');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.append(el('p', 'count', state.doneText));
      const frag = [live];
      if (state.saved?.note) frag.push(el('p', 'fine', state.saved.note));
      const row = el('div', 'row');
      if (state.saved?.rule) row.append(button('Undo', { key: 'Ctrl+Z', onClick: undo, disabled: state.busy }));
      row.append(button('Done', { onClick: stop }));
      frag.push(row);
      const bar = el('div', 'bar');
      const fill = el('i');
      bar.append(fill);
      if (state.saved?.rule) frag.push(bar);
      body.replaceChildren(...frag);
      if (state.saved?.rule) {
        fill.style.transition = `transform ${UNDO_MS}ms linear`;
        requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.transform = 'scaleX(0)')));
      }
    }

    function render() {
      host.setAttribute(HOST_ATTR, state.phase);
      if (state.phase === 'pick') renderPick();
      else if (state.phase === 'review') renderReview();
      else renderDone();
      scheduleLayout();
    }

    // --- choosing -------------------------------------------------------------------------
    function pickAt(hit) {
      if (!hit || !hit.isConnected) return;
      const { chain, stoppedAtFrame } = buildChain(hit, doc);
      state.chain = chain;
      state.stoppedAtFrame = stoppedAtFrame;
      state.index = 0;
      state.only = false;
      state.message = '';
      state.cache = new Map();
      state.phase = 'review';
      render();
      shadowFocusPrimary(); // Enter = Hide, and a screen reader is told where we are
    }

    function shadowFocusPrimary() {
      const primary = shadow.querySelector('button.primary');
      if (primary && !primary.disabled) primary.focus({ preventScroll: true });
    }

    function step(delta) {
      if (state.phase !== 'review') return;
      const next = state.index + delta;
      if (next < 0 || next >= state.chain.length) return;
      if (delta > 0 && evaluate(next)?.ok === false) {
        state.message = 'Bigger than that would be most of the page, so this is as big as it goes.';
        render();
        return;
      }
      state.index = next;
      state.message = '';
      if (state.only && evaluate()?.ok === false) state.only = false;
      render();
    }

    // --- saving ---------------------------------------------------------------------------
    const rulesOf = (settings) => (Array.isArray(settings['advanced.customRules']) ? settings['advanced.customRules'] : []);

    async function commit() {
      const res = state.phase === 'review' ? evaluate() : null;
      if (!res?.ok || state.busy) return;
      state.busy = true;
      render();
      try {
        const settings = await AP.settings.effective();
        const rules = rulesOf(settings);
        const page = state.scope === 'page' ? state.page : null;
        if (rules.some((r) => r.selector === res.selector && (r.page ?? null) === page)) {
          state.message = 'That one is already hidden.';
          return;
        }
        if (rules.length >= MAX_RULES) {
          state.message = `You already hide ${MAX_RULES} things. Remove some in Settings first.`;
          return;
        }
        const rule = {
          id: AP.util.uid('rule'),
          selector: res.selector,
          page,
          note: noteFor(res.label, page),
          createdAt: Date.now(),
        };
        const report = await AP.settings.save({ 'advanced.customRules': [...rules, rule] });
        if (!report.changed.includes('advanced.customRules')) {
          state.message = 'That could not be saved. Try a different piece.';
          return;
        }
        const n = res.visible || res.count;
        state.saved = {
          rule,
          note: settings['general.enabled'] === false ? 'At Peace is turned off right now, so it will stay visible until you turn it back on.' : '',
        };
        state.doneText = n > 1 ? `Hidden: ${n} items${page ? ` on ${PAGE_FOR_NOTE[page] ?? `${page} pages`}` : ''}.` : `Hidden${page ? ` on ${PAGE_FOR_NOTE[page] ?? `${page} pages`}` : ''}.`;
        state.busy = false; // before the confirmation draws, or its Undo would start disabled
        enterDone();
      } catch (err) {
        AP.warn('picker could not save the rule', err);
        state.message = 'That could not be saved. Try again in a moment.';
      } finally {
        state.busy = false;
        if (state.phase === 'review') render();
      }
    }

    async function undo() {
      const rule = state.saved?.rule;
      if (!rule || state.busy) return;
      state.busy = true;
      try {
        const settings = await AP.settings.effective();
        await AP.settings.save({ 'advanced.customRules': rulesOf(settings).filter((r) => r.id !== rule.id) });
        state.saved = null;
        state.doneText = 'Brought back.';
        state.busy = false;
        render();
        for (const t of state.timers) clearTimeout(t);
        state.timers.clear();
        later(stop, 1500);
      } catch (err) {
        AP.warn('picker could not undo', err);
        state.busy = false;
        render();
      }
    }

    function enterDone() {
      // The page is the person's again; only the panel stays, for a few seconds.
      removeBlockers();
      state.phase = 'done';
      removers.push(listen(window, 'keydown', onDoneKey, { capture: true }));
      render();
      later(stop, UNDO_MS);
    }

    // --- page listeners -------------------------------------------------------------------
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      return () => target.removeEventListener(type, handler, options);
    }
    const blockers = [];
    function removeBlockers() {
      for (const off of blockers.splice(0)) off();
    }

    const ours = (event) => event.target === host;

    function hitAt(x, y) {
      try {
        const hit = doc.elementFromPoint(x, y);
        return hit && hit !== host ? hit : null;
      } catch {
        return null;
      }
    }

    function onPointerBlock(event) {
      if (!event.isTrusted || ours(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click' && event.button === 0) {
        const hit = hitAt(event.clientX, event.clientY) ?? (event.target instanceof Element ? event.target : null);
        pickAt(hit);
      }
    }

    function onHoverBlock(event) {
      if (!event.isTrusted) return;
      event.stopImmediatePropagation();
    }

    function onMove(event) {
      if (!event.isTrusted) return;
      event.stopImmediatePropagation();
      if (ours(event)) {
        state.pointer = null;
        return;
      }
      state.pointer = { x: event.clientX, y: event.clientY };
      if (state.phase === 'pick') scheduleHover();
    }

    let hoverRaf = 0;
    function scheduleHover() {
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        if (state.phase !== 'pick' || !state.pointer) return;
        const hit = hitAt(state.pointer.x, state.pointer.y);
        const first = hit ? buildChain(hit, doc).chain[0] ?? null : null;
        if (first === null && state.hover === null) return;
        if (first && state.hover && first.el === state.hover.el) return;
        state.hover = first;
        state.hoverRefused = first ? isOversized(first.el, viewport()) : false;
        scheduleLayout();
      });
    }

    function panelButtonFocused() {
      const active = shadow.activeElement;
      return Boolean(active && active.matches?.(':focus-visible') && (active.tagName === 'BUTTON' || active.getAttribute('role') === 'radio' || active.tagName === 'INPUT'));
    }

    function onKey(event) {
      if (!event.isTrusted) return;
      const inPanel = ours(event);
      if (event.type === 'keydown') {
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
        let handled = false;
        if (event.key === 'Escape') {
          stop();
          handled = true;
        } else if (plain && state.phase === 'review' && event.key === 'ArrowUp') {
          step(1);
          handled = true;
        } else if (plain && state.phase === 'review' && event.key === 'ArrowDown') {
          step(-1);
          handled = true;
        } else if (plain && state.phase === 'review' && event.key === 'Enter' && !panelButtonFocused()) {
          commit();
          handled = true;
        }
        if (handled) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // Keys typed on the page itself must not reach YouTube's shortcuts or its search box.
        if (!inPanel && plain) event.preventDefault();
      }
      event.stopImmediatePropagation();
    }

    function onDoneKey(event) {
      if (!event.isTrusted) return;
      if (event.key === 'Escape') {
        stop();
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && state.saved?.rule) {
        event.preventDefault();
        event.stopImmediatePropagation();
        undo();
      }
    }

    const onViewportChange = () => scheduleLayout();
    // A page change under our feet (YouTube is a single-page app): the picked element is gone, so start over.
    const onNavigated = () => {
      if (state.phase === 'done') return;
      state.page = currentPage();
      state.chain = [];
      state.hover = null;
      state.cache = new Map();
      state.phase = 'pick';
      state.message = '';
      render();
    };

    // Listening: everything on window, capture phase, so we see events before the page's own handlers
    // on elements do. Options are objects so removal matches exactly.
    const capture = { capture: true, passive: false };
    for (const type of POINTER_EVENTS) blockers.push(listen(window, type, onPointerBlock, capture));
    for (const type of HOVER_EVENTS) blockers.push(listen(window, type, onHoverBlock, capture));
    for (const type of MOVE_EVENTS) blockers.push(listen(window, type, onMove, capture));
    for (const type of KEY_EVENTS) blockers.push(listen(window, type, onKey, capture));
    removers.push(
      listen(window, 'scroll', onViewportChange, { capture: true, passive: true }),
      listen(window, 'resize', onViewportChange, { passive: true }),
      listen(window, 'yt-navigate-finish', onNavigated, { capture: true }),
      listen(window, 'popstate', onNavigated, { capture: true }),
    );
    // The panel's own clicks stay inside it (YouTube's "click outside closes the menu" logic must not see them).
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'wheel']) {
      removers.push(listen(host, type, (event) => event.stopPropagation(), { passive: true }));
    }

    // Cursor: a crosshair over everything while picking (one removable <style>).
    cursorStyle = doc.createElement('style');
    cursorStyle.setAttribute('data-at-peace-picker-style', '');
    cursorStyle.textContent = 'html, html * { cursor: crosshair !important; }';
    root.append(cursorStyle);

    root.append(host);
    // The page may rebuild <html>'s children: put the panel back if it vanishes.
    let keepAlive = null;
    if (typeof MutationObserver === 'function') {
      keepAlive = new MutationObserver(() => {
        if (!host.isConnected) root.append(host);
        if (cursorStyle && !cursorStyle.isConnected && state.phase !== 'done') root.append(cursorStyle);
      });
      keepAlive.observe(root, { childList: true });
    }

    // Light/dark follows the person's setting.
    AP.settings.effective().then(
      (settings) => {
        const theme = settings['general.theme'];
        layer.dataset.theme = theme === 'dark' || theme === 'system' ? theme : 'light';
      },
      () => {},
    );

    render();

    function destroy() {
      removeBlockers();
      for (const off of removers.splice(0)) off();
      for (const t of state.timers) clearTimeout(t);
      state.timers.clear();
      if (state.raf) cancelAnimationFrame(state.raf);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      keepAlive?.disconnect();
      cursorStyle?.remove();
      host.remove();
    }

    return {
      destroy,
      inspect: () => ({
        phase: state.phase,
        selector: evaluate()?.selector ?? null,
        count: evaluate()?.count ?? 0,
        scope: state.scope,
        page: state.page,
        index: state.index,
        steps: state.chain.length,
        only: state.only,
        savedRuleId: state.saved?.rule?.id ?? null,
      }),
    };
  }

  // ===========================================================================================
  // Part 3. Wiring
  // ===========================================================================================

  AP.picker = {
    start,
    stop,
    isActive: () => session !== null,
    /** Test hook: what the session currently says (phase, selector, scope…), or null. */
    inspect: () => session?.inspect() ?? null,
    selector: core,
  };

  // START_PICKER arrives from the popup's "Hide an element" and from the keyboard command, both through
  // the background. Answered synchronously through sendResponse: Chrome (our test browser) does not
  // accept a returned Promise from onMessage listeners, Firefox accepts either.
  try {
    AP.api?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (!AP.util.isPlainObject(message) || message.type !== AP.msg.TYPES.START_PICKER) return undefined;
      sendResponse(start());
      return false;
    });
  } catch (err) {
    AP.warn('picker could not listen for START_PICKER', err);
  }
})();
