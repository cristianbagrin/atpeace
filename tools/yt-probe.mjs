#!/usr/bin/env node
/* global document, window, getComputedStyle, Node */
// yt-probe — look at the live YouTube DOM from the command line (maintenance / research tool).
//
//   node tools/yt-probe.mjs <url | /path | saved.html> [options]
//
// A *.dom.json or *.html argument is OFFLINE mode: it opens a dump previously written with --dom
// (exact tree, rebuilt with createElement, no HTML parser involved) or --html (re-parsed HTML:
// the parser may re-nest elements that were invalid HTML in the live DOM, e.g. <a> in <a>), so you
// can run --count / --root / --eval against a snapshot without touching youtube.com. Prefer
// --dom; confirm anything structural (parent/child combinators) with a live run. Snapshots carry
// no CSS, so "vis" counts are meaningless offline.
//
// Outline mode (default): prints a collapsed DOM outline of one or more root selectors:
//   tag#id.non-generated-classes[key attributes]  — runs of same-shape siblings are collapsed
//   into "x N" and only the first of the run is expanded.
//
// Options
//   --root <sel>        Root selector to outline (repeatable, or comma-separated list of
//                       roots separated by ";;"). Default: ytd-app.  Only the first match of
//                       each root is outlined; the total match count is printed.
//   --depth <n>         Outline depth (default 6)
//   --classes <n>       Max classes shown per node (default 4)
//   --attrs a,b,c       Extra attributes to show (on top of a built-in list)
//   --text              Show a short text snippet for leaf elements
//   --count <sel>       Count mode (repeatable): prints "total / visible" match counts for the
//                       selector. Selectors are used verbatim (use --count-file for many).
//   --count-file <f>    File with one selector per line (blank lines and lines starting
//                       with # are ignored). Optional "  # comment" suffix is stripped.
//   --shot <file.png>   Save a screenshot (add --full for the whole scroll height)
//   --dom <file.dom.json>  Save an exact tree snapshot (tag/attrs/text; scripts+styles removed)
//   --html <file>       Save the rendered DOM as HTML (scripts/styles removed) for grepping
//   --eval <js>         Evaluate a JS expression in the page and print the JSON result
//   --click <sel>       Click the first match of this selector before dumping (repeatable)
//   --wait <ms>         Wait after load (default 9000)
//   --scroll <n>        Scroll n x 1000 px, 1.5 s apart, to trigger lazy content (default 2)
//   --profile <dir>     Use a persistent browser profile (cookies survive between runs)
//   --headed            Show the browser window
//   --viewport WxH      Default 1440x900
//   --json              Machine-readable output
//
// Environment: PLAYWRIGHT_PATH (default /opt/node22/lib/node_modules/playwright/index.mjs),
// HTTPS_PROXY (used when set; in the cloud sandbox it and `channel: 'chromium'` are required).
//
// Notes
//  - Logged out, with no watch history, the home feed is empty ("Try searching to get started").
//    Use --profile with a profile you signed into by hand (--headed) to see the real home feed.
//  - Do not hammer YouTube: after ~10 navigations in a few minutes Google answers with a
//    captcha ("/sorry/") that sticks to the cookie jar. The tool reports it when it happens.
//  - Never put visible text in a selector you intend to ship (PLAN §6.2 rule 2). This tool prints
//    aria-label values only to help you identify elements.

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright/index.mjs';

/** Attributes worth showing in an outline (on top of id/class). */
export const DEFAULT_ATTRS = [
  'page-subtype', 'is-shorts', 'role', 'type', 'target-id', 'overlay-style', 'tab-title',
  'theater', 'fullscreen', 'is-two-columns_', 'hidden', 'is-post', 'is-slim-media',
  'aria-checked', 'aria-pressed', 'href', 'src', 'name', 'content-id', 'content-type',
  'icon', 'chip-style', 'engagement-panel-section', 'state', 'rendered-from-continuation',
];

/** Runs in the page: returns outline text for the given roots. Exported so other scripts can reuse it. */
export function outlineInPage({ roots, depth, maxClasses, attrs, withText }) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'PATH', 'G', 'CIRCLE', 'RECT', 'DEFS', 'CLIPPATH']);
  const generated = (c) => c.startsWith('style-scope') || c.startsWith('x-scope') || c === 'yt-simple-endpoint-nowrap';
  const shape = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = [...el.classList].filter((c) => !generated(c));
    if (cls.length) s += '.' + cls.slice(0, maxClasses).join('.');
    return s;
  };
  const desc = (el) => {
    let s = shape(el);
    for (const a of attrs) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      s += v === '' ? `[${a}]` : `[${a}=${JSON.stringify(v.length > 48 ? v.slice(0, 48) + '…' : v)}]`;
    }
    if (withText && !el.children.length) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t) s += ` "${t.length > 36 ? t.slice(0, 36) + '…' : t}"`;
    }
    return s;
  };
  const lines = [];
  const walk = (el, d) => {
    if (d > depth) return;
    const kids = [...el.children].filter((k) => !SKIP.has(k.tagName.toUpperCase()));
    for (let i = 0; i < kids.length; ) {
      const k = kids[i];
      const key = shape(k);
      let j = i + 1;
      while (j < kids.length && shape(kids[j]) === key) j++;
      const n = j - i;
      lines.push('  '.repeat(d) + desc(k) + (n > 1 ? `  x${n}` : ''));
      walk(k, d + 1);
      i = j;
    }
  };
  for (const r of roots) {
    let list = [];
    try { list = document.querySelectorAll(r); } catch { /* invalid selector */ }
    lines.push(`### ${r}  (${list.length} match${list.length === 1 ? '' : 'es'})`);
    if (list[0]) {
      lines.push(desc(list[0]));
      walk(list[0], 1);
    }
  }
  return lines.join('\n');
}

/** Runs in the page: match counts for selectors. visible = has layout boxes. */
export function countInPage(selectors) {
  return selectors.map((sel) => {
    try {
      const els = [...document.querySelectorAll(sel)];
      const visible = els.filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length;
      const first = els[0];
      let sample = '';
      if (first) {
        sample = first.tagName.toLowerCase() + (first.id ? '#' + first.id : '');
        const href = first.getAttribute('href');
        if (href) sample += ` href=${href.slice(0, 50)}`;
      }
      return { sel, total: els.length, visible, sample };
    } catch (e) {
      return { sel, error: String(e.message || e) };
    }
  });
}

/** Strip scripts/styles and serialise the DOM (runs in the page). */
export function serialiseInPage() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, link[rel="stylesheet"], link[rel="preload"], iframe').forEach((n) => n.remove());
  return '<!doctype html>\n' + clone.outerHTML;
}

/** Exact tree snapshot (runs in the page): nested [tag, attrs, children?, svgNs?] arrays + text strings. */
export function domToJsonInPage() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'IFRAME']);
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const ser = (n) => {
    if (n.nodeType === 3) return n.nodeValue.trim() ? n.nodeValue.replace(/\s+/g, ' ') : null;
    if (n.nodeType !== 1 || SKIP.has(n.tagName.toUpperCase())) return null;
    const attrs = {};
    for (const a of n.attributes) attrs[a.name] = a.value;
    const kids = [];
    for (const c of n.childNodes) {
      const s = ser(c);
      if (s !== null) kids.push(s);
    }
    const out = [n.localName, attrs];
    if (kids.length) out.push(kids);
    if (n.namespaceURI !== XHTML) { if (!kids.length) out.push(0); out.push(n.namespaceURI); }
    return out;
  };
  return JSON.stringify(ser(document.documentElement));
}

/** Rebuild a snapshot written by domToJsonInPage into the current (blank) document. */
export function loadDomInPage(json) {
  const build = (t) => {
    if (typeof t === 'string') return document.createTextNode(t);
    const [tag, attrs, kids, ns] = t;
    const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const k of Object.keys(attrs)) {
      try { el.setAttribute(k, attrs[k]); } catch { /* attribute name not valid for setAttribute */ }
    }
    if (Array.isArray(kids)) for (const c of kids) el.appendChild(build(c));
    return el;
  };
  document.replaceChild(build(JSON.parse(json)), document.documentElement);
}

export async function launch({ profile, headed, viewport = '1440x900', offline = false } = {}) {
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
  const [width, height] = viewport.split('x').map(Number);
  const common = {
    headless: !headed,
    channel: 'chromium',
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  };
  const ctxOpts = { viewport: { width, height }, locale: 'en-US' };
  if (profile) {
    const context = await chromium.launchPersistentContext(profile, { ...common, ...ctxOpts });
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page, close: () => context.close() };
  }
  const browser = await chromium.launch(common);
  const context = await browser.newContext(ctxOpts);
  if (offline) await context.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  const page = await context.newPage();
  return { context, page, close: () => browser.close() };
}

/** Navigate, wait, scroll. Returns false when Google served its captcha page. */
export async function load(page, url, { wait = 9000, scroll = 2 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(wait);
  for (let i = 0; i < scroll; i++) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(1500);
  }
  return !/google\.com\/sorry/.test(page.url());
}

function parse() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: 'string', multiple: true },
      depth: { type: 'string', default: '6' },
      classes: { type: 'string', default: '4' },
      attrs: { type: 'string', default: '' },
      text: { type: 'boolean', default: false },
      count: { type: 'string', multiple: true },
      'count-file': { type: 'string' },
      shot: { type: 'string' },
      full: { type: 'boolean', default: false },
      html: { type: 'string' },
      dom: { type: 'string' },
      eval: { type: 'string' },
      click: { type: 'string', multiple: true },
      wait: { type: 'string', default: '9000' },
      scroll: { type: 'string', default: '2' },
      profile: { type: 'string' },
      headed: { type: 'boolean', default: false },
      viewport: { type: 'string', default: '1440x900' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { values, url: positionals[0] };
}

async function main() {
  const { values: o, url } = parse();
  if (o.help || !url) {
    console.log((await readFile(new URL(import.meta.url), 'utf8')).split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(url || o.help ? 0 : 1);
  }
  const offline = /\.(dom\.json|html?)$/i.test(url) && existsSync(url);
  const domJson = offline && /\.dom\.json$/i.test(url);
  const target = offline
    ? pathToFileURL(resolve(url)).href
    : /^https?:/.test(url) ? url : 'https://www.youtube.com' + (url.startsWith('/') ? url : '/' + url);

  const countSels = [...(o.count ?? [])];
  if (o['count-file']) {
    const txt = await readFile(o['count-file'], 'utf8');
    for (const line of txt.split('\n')) {
      const s = line.replace(/\s+#.*$/, '').trim();
      if (s && !s.startsWith('#')) countSels.push(s);
    }
  }
  const roots = (o.root?.length ? o.root : ['ytd-app']).flatMap((r) => r.split(';;')).map((s) => s.trim()).filter(Boolean);
  const attrs = [...DEFAULT_ATTRS, ...o.attrs.split(',').map((s) => s.trim()).filter(Boolean)];

  const { page, close } = await launch({ profile: o.profile, headed: o.headed, viewport: o.viewport, offline });
  const result = { url: target };
  try {
    let ok = true;
    if (domJson) {
      await page.goto('about:blank');
      await page.evaluate(loadDomInPage, await readFile(url, 'utf8'));
    } else {
      ok = await load(page, target, offline ? { wait: 300, scroll: 0 } : { wait: +o.wait, scroll: +o.scroll });
    }
    result.finalUrl = domJson ? target : page.url();
    result.title = await page.title();
    if (!ok) {
      console.error('Google served the "/sorry/" captcha page. Wait a while / use a fresh profile (no --profile) and retry.');
      process.exitCode = 2;
      return;
    }
    for (const sel of o.click ?? []) {
      try { await page.locator(sel).first().click({ timeout: 5000 }); await page.waitForTimeout(1500); } catch (e) { console.error('click failed:', sel, String(e.message).split('\n')[0]); }
    }
    // --eval takes a JS *expression* (e.g. 'document.title' or '[...document.links].length').
    if (o.eval) result.eval = await page.evaluate(`(() => (${o.eval}))()`);
    if (countSels.length) result.counts = await page.evaluate(countInPage, countSels);
    if (!countSels.length && !o.eval) {
      result.outline = await page.evaluate(outlineInPage, { roots, depth: +o.depth, maxClasses: +o.classes, attrs, withText: o.text });
    }
    if (o.shot) await page.screenshot({ path: o.shot, fullPage: o.full });
    if (o.html) await writeFile(o.html, await page.evaluate(serialiseInPage));
    if (o.dom) await writeFile(o.dom, await page.evaluate(domToJsonInPage));
  } finally {
    await close();
  }

  if (o.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`URL    ${result.finalUrl}\nTITLE  ${result.title}`);
  if (result.eval !== undefined) console.log(JSON.stringify(result.eval, null, 2));
  if (result.counts) {
    const w = Math.min(90, Math.max(...result.counts.map((c) => c.sel.length)));
    for (const c of result.counts) {
      console.log(c.error ? `ERR   ${c.sel}  (${c.error})` : `${String(c.total).padStart(5)} / ${String(c.visible).padStart(4)}vis  ${c.sel.padEnd(w)}  ${c.sample}`);
    }
  }
  if (result.outline) console.log(result.outline);
  if (o.shot) console.log('screenshot ->', o.shot);
  if (o.html) console.log('html       ->', o.html);
  if (o.dom) console.log('dom        ->', o.dom);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
