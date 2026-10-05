// Offline YouTube pages for E2E specs (no traffic to Google, whose captcha rate-limits shared IPs).
//
// The Phase 1 research left exact DOM snapshots of real YouTube pages in
// tests/e2e/artifacts/research/*.dom.json (git-ignored, local only; tools/yt-probe.mjs writes them
// with domToJsonInPage). This module turns one of them into a page that a browser can load at a
// www.youtube.com URL: the content scripts match the URL and inject as on the real site, but the
// document comes from the snapshot. A small "wireframe" stylesheet stands in for YouTube's own CSS
// (the snapshots carry none), so elements have believable boxes: enough for hover highlights, the
// viewport-share check and screenshots, nothing more. Requests to YouTube's image hosts are answered
// with a grey PNG so nothing leaves the machine.
//
//   fixturesAvailable(names?)           → boolean; specs call it first and skip when it is false
//   fixtureNameForUrl(url)              → snapshot name for a www.youtube.com URL (or null)
//   fixtureHtml(name, { url? })         → the HTML document (string)
//   installYouTubeFixtures(context, {  → Playwright: answers every https://www.youtube.com/** request
//     map?, stubImages? })                 with the matching snapshot (others: 404), returns { hits }
//   startFixtureServer()                → http server (Firefox suite): same pages at http://www.youtube.com:<port>/
//
// Playwright is loaded by harness.mjs; this file has no dependency on it.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { ARTIFACTS } from './harness.mjs';

export const RESEARCH_DIR = join(ARTIFACTS, 'research');

/** The snapshots the pages below are built from (a fresh clone has none). */
export const SNAPSHOTS = ['home', 'watch-chapters', 'search-lofi', 'channel-videos', 'playlist', 'hashtag', 'feed-history'];

const snapshotPath = (name) => join(RESEARCH_DIR, `${name}.dom.json`);

/** True when every named snapshot (default: all of SNAPSHOTS) exists on this machine. */
export function fixturesAvailable(names = SNAPSHOTS) {
  return names.every((name) => existsSync(snapshotPath(name)));
}

/**
 * Which snapshot stands in for a www.youtube.com URL (page types as in PLAN 6.1).
 * @param {string|URL} url
 * @returns {string|null}
 */
export function fixtureNameForUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  const [first = '', second = ''] = parsed.pathname.split('/').filter(Boolean);
  if (first === '') return 'home';
  if (first === 'watch') return 'watch-chapters';
  if (first === 'results') return 'search-lofi';
  if (first === 'playlist') return 'playlist';
  if (first === 'hashtag') return 'hashtag';
  if (first === 'feed') return second === 'history' ? 'feed-history' : null;
  if (first.startsWith('@') || first === 'channel') return 'channel-videos';
  return null;
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

const GREY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcvm//fwAIuwOFZHuq3QAAAABJRU5ErkJggg==',
  'base64',
);

/** Stylesheet standing in for YouTube's CSS. Everything is deliberately plain. */
const WIREFRAME_CSS = `
html { font-size: 62.5%; }
body { margin: 0; font: 1.4rem/2rem Roboto, Arial, sans-serif; color: #0f0f0f; background: #fff; }
[hidden] { display: none !important; }
a { color: inherit; text-decoration: none; }
img { display: block; width: 100%; height: 100%; max-height: 220px; object-fit: cover; background: #d9dce3; }
svg { width: 24px !important; height: 24px !important; }
input[type=file] { display: none; }
iron-iconset-svg, dom-if, dom-repeat, ps-dom-if, ps-dom-repeat, custom-style, tp-yt-paper-tooltip, yt-interaction,
yt-touch-feedback-shape, yt-guide-manager, yt-mdx-manager, yt-playlist-manager, yt-hotkey-manager, iron-media-query,
ytd-miniplayer, ytd-mini-guide-renderer, ytd-popup-container, yt-tooltip, yt-ephemeral-actions, snackbar-container,
yt-draggable, ytd-lottie-player, ytd-yoodle-renderer, ytd-video-preview-loader { display: none; }
ytd-masthead { display: flex; align-items: center; position: fixed; top: 0; left: 0; right: 0; height: 56px; z-index: 5; padding: 0 16px; gap: 24px; background: #fff; border-bottom: 1px solid #e5e5e5; box-sizing: border-box; }
ytd-masthead { overflow: hidden; }
ytd-masthead div, ytd-masthead #container { display: flex; align-items: center; gap: 8px; }
ytd-masthead #center { flex: 1; max-width: 640px; }
ytd-masthead yt-searchbox { display: block; height: 40px; width: 100%; overflow: hidden; border: 1px solid #ccc; border-radius: 20px; }
ytd-masthead #end, ytd-masthead #buttons { margin-left: auto; }
ytd-masthead yt-icon-button, ytd-masthead button { max-height: 40px; }
tp-yt-app-drawer#guide { display: block; position: fixed; left: 0; top: 56px; bottom: 0; width: 240px; padding: 12px; overflow: hidden; box-sizing: border-box; }
ytd-guide-entry-renderer { height: 40px; }
ytd-guide-entry-renderer a { display: flex; align-items: center; gap: 12px; height: 40px; }
yt-chip-cloud-renderer #chips, chip-bar-view-model, ytd-feed-filter-chip-bar-renderer #chips { display: flex; gap: 8px; }
ytd-page-manager { margin: 56px 0 0 240px; min-height: 600px; }
ytd-rich-grid-renderer #contents { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px 16px; padding: 24px; }
ytd-rich-item-renderer, ytd-rich-section-renderer { display: block; }
ytd-rich-item-renderer yt-lockup-view-model { display: block; }
yt-thumbnail-view-model, ytd-thumbnail { display: block; aspect-ratio: 16 / 9; background: #d9dce3; border-radius: 8px; overflow: hidden; }
ytd-thumbnail yt-image, yt-thumbnail-view-model yt-image { display: block; height: 100%; }
yt-lockup-metadata-view-model { display: block; padding: 8px 0; }
ytd-search #contents.ytd-item-section-renderer, ytd-search #contents.ytd-section-list-renderer { padding: 0 24px; }
ytd-video-renderer { display: flex; gap: 16px; padding: 8px 0; }
ytd-video-renderer ytd-thumbnail { width: 246px; flex: none; }
ytd-video-renderer #dismissible { display: flex; gap: 16px; }
ytd-video-renderer .text-wrapper { flex: 1; }
ytd-watch-flexy #full-bleed-container, ytd-watch-flexy #microformat, ytd-watch-flexy #single-column-container, ytd-watch-flexy #panels-full-bleed-container { display: none; }
ytd-engagement-panel-section-list-renderer:not([visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]), ytd-watch-flexy #player ytd-thumbnail { display: none; }
ytd-watch-flexy #columns { display: flex; gap: 24px; padding: 24px; }
ytd-watch-flexy #primary { flex: 1 1 0; min-width: 0; }
ytd-watch-flexy #secondary { flex: none; width: 400px; }
ytd-watch-flexy #player, ytd-watch-flexy #player-container { display: block; }
ytd-watch-flexy ytd-player { display: block; position: relative; overflow: hidden; height: 460px; background: #0c0c0c; border-radius: 12px; }
ytd-watch-flexy ytd-player * { max-height: 460px; }
ytd-watch-flexy #related yt-lockup-view-model { display: block; margin-bottom: 8px; }
ytd-watch-flexy #related .ytLockupViewModelHost { display: flex; gap: 8px; }
ytd-watch-flexy #related yt-thumbnail-view-model { width: 168px; flex: none; }
ytd-comments { display: block; padding-top: 16px; }
ytd-comment-thread-renderer { padding: 8px 0; }
yt-icon, yt-icon-button { display: inline-block; width: 24px; height: 24px; }
yt-formatted-string, yt-attributed-string, yt-img-shadow, yt-image, yt-badge-supported-renderer, ytd-badge-supported-renderer,
badge-shape, yt-button-shape, button-view-model, yt-button-view-model, ytd-channel-name, ytd-video-meta-block { display: inline-block; }
ytd-menu-renderer, ytd-toggle-button-renderer, ytd-button-renderer, tp-yt-paper-button { display: inline-block; }
yt-img-shadow { width: 36px; height: 36px; border-radius: 50%; overflow: hidden; }
`;

/** Runs in the page (stringified into the HTML): rebuilds a snapshot written by domToJsonInPage. */
function buildInPage(json) {
  const build = (t) => {
    if (typeof t === 'string') return document.createTextNode(t);
    const [tag, attrs, kids, ns] = t;
    const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const k of Object.keys(attrs)) {
      try {
        el.setAttribute(k, attrs[k]);
      } catch {
        /* attribute name not valid for setAttribute */
      }
    }
    if (Array.isArray(kids)) for (const c of kids) el.appendChild(build(c));
    return el;
  };
  const root = JSON.parse(json);
  const [, rootAttrs, parts] = root;
  const html = document.documentElement;
  for (const [k, v] of Object.entries(rootAttrs)) if (!k.startsWith('data-at-peace')) html.setAttribute(k, v);
  const head = parts.find((p) => Array.isArray(p) && p[0] === 'head');
  const body = parts.find((p) => Array.isArray(p) && p[0] === 'body');
  if (head && Array.isArray(head[2])) {
    for (const c of head[2]) if (Array.isArray(c) && c[0] === 'title') document.title = c[2]?.[0] ?? '';
  }
  if (body) {
    for (const [k, v] of Object.entries(body[1])) document.body.setAttribute(k, v);
    if (Array.isArray(body[2])) for (const c of body[2]) document.body.appendChild(build(c));
  }
  // Unknown elements are inline by default; YouTube's components are blocks (its own CSS is not in the snapshot).
  const custom = new Set();
  for (const el of document.body.querySelectorAll('*')) if (el.localName.includes('-')) custom.add(el.localName);
  const generic = document.createElement('style');
  generic.textContent = `${[...custom].join(',')} { display: block; }`;
  document.head.insertBefore(generic, document.getElementById('fixture-style'));
  document.documentElement.setAttribute('data-fixture-ready', '1');
}

/**
 * The HTML document for a snapshot. The snapshot travels as an escaped string inside an inline
 * script that rebuilds it on DOMContentLoaded (exact tree: no HTML re-parsing, so nothing is
 * re-nested), after the extension's document_start content script has already run.
 * @param {string} name snapshot name (SNAPSHOTS)
 * @returns {Promise<string>}
 */
export async function fixtureHtml(name) {
  const json = await readFile(snapshotPath(name), 'utf8');
  // JSON.stringify makes a JS string literal; escaping "<" keeps "</script>" and "<!--" out of the markup.
  const literal = JSON.stringify(json)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g'), (c) => '\\u' + c.charCodeAt(0).toString(16));
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube (fixture)</title>' +
    `<style id="fixture-style">${WIREFRAME_CSS}</style>` +
    `<script>document.addEventListener('DOMContentLoaded', () => (${buildInPage.toString()})(${literal}));</script>` +
    '</head><body></body></html>'
  );
}

// ---------------------------------------------------------------------------------------------
// Serving it
// ---------------------------------------------------------------------------------------------

const IMAGE_HOSTS = /^https:\/\/(i\d?\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com|lh\d\.googleusercontent\.com)\//;

/**
 * Playwright: answers every https://www.youtube.com/** request with the snapshot page for its URL
 * (see fixtureNameForUrl; override with `map`), anything else on that host with a 404 page, and the
 * image hosts with a grey PNG. Every other host is aborted: a spec on fixtures never touches the net.
 * @param {import('playwright').BrowserContext} context
 * @param {{ map?: (url: string) => string|null, stubImages?: boolean }} [options]
 * @returns {Promise<{ hits: string[] }>} the URLs served, for assertions
 */
export async function installYouTubeFixtures(context, { map = fixtureNameForUrl, stubImages = true } = {}) {
  const state = { hits: [] };
  const cache = new Map();
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
    const url = route.request().url();
    if (/^https:\/\/www\.youtube\.com\//.test(url)) {
      state.hits.push(url);
      const name = map(url);
      if (!name) return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not in the fixtures</title>' });
      if (!cache.has(name)) cache.set(name, await fixtureHtml(name));
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: cache.get(name) });
    }
    if (stubImages && IMAGE_HOSTS.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', body: GREY_PNG });
    return route.abort();
  });
  return state;
}

/**
 * A local http server for suites that cannot intercept requests (the Selenium/Firefox suite):
 * point `www.youtube.com` at 127.0.0.1 (pref network.dns.localDomains) and load
 * http://www.youtube.com:<port>/watch?v=x. Content-script match patterns ignore the port and scheme
 * `*`, so the extension injects exactly as on the real site.
 * @param {(url: string) => string|null} [map]
 * @returns {Promise<{ port: number, hits: string[], origin: string, close: () => Promise<void> }>}
 */
export async function startFixtureServer(map = fixtureNameForUrl) {
  const hits = [];
  const cache = new Map();
  const server = createServer(async (req, res) => {
    try {
      hits.push(req.url);
      const name = map(`https://www.youtube.com${req.url}`);
      if (!name) {
        res.writeHead(404, { 'content-type': 'text/html' }).end('<!doctype html><title>Not in the fixtures</title>');
        return;
      }
      if (!cache.has(name)) cache.set(name, await fixtureHtml(name));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(cache.get(name));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { port, hits, origin: `http://www.youtube.com:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
