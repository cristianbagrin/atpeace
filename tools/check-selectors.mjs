#!/usr/bin/env node
/* global document, window, getComputedStyle */
// check-selectors — coverage report for every CSS selector in the YouTube settings catalog.
//
//   node tools/check-selectors.mjs                 offline: DOM snapshots in tests/e2e/artifacts/research/*.dom.json
//   node tools/check-selectors.mjs --live          live: reloads representative pages on youtube.com
//   npm run selectors                              same as the first form
//
// For every selector of every setting (`hide` lists, `variants`, and the selector part of `rules`)
// it counts matches on the pages where the setting is expected to work (its `page:`, or every page)
// and writes docs/selector-report.md:
//   ✅ matched            ≥ 1 match on an expected page
//   ⚠️ 0 matches          nothing matched there (see the note: signed-in only, set by the page bridge, …)
//   ❌ invalid selector   querySelectorAll throws
// It also flags selectors that match somewhere they must never match: <html>, <body>, ytd-app, the
// app-level #content, ytd-page-manager (anything that would blank the whole site) and, live only,
// any selector whose matches cover more than 60 % of the viewport. That check applies to rules that
// remove content (display:none / visibility:hidden), not to filters or margin fixes.
//
// Options
//   --live             fetch live pages instead of reading snapshots
//   --pause <sec>      seconds between live page loads (default 45; Google rate-limits with a /sorry/ captcha)
//   --profile <dir>    persistent browser profile for --live (default ~/.cache/at-peace/yt-profile).
//                      Sign in once with `node tools/yt-probe.mjs / --headed --profile <dir>` to cover
//                      the signed-in guide, masthead and home feed.
//   --snapshots <dir>  where the *.dom.json files are (default tests/e2e/artifacts/research)
//   --out <file>       report path (default docs/selector-report.md)
//   --viewport WxH     default 1440x900
//   --headed           show the browser (live)
//
// Exit code: 1 when a selector is invalid or matches something it must not; zero matches are only warnings.
//
// Environment: same as tools/yt-probe.mjs (PLAYWRIGHT_PATH, HTTPS_PROXY, `channel: 'chromium'`).

import { parseArgs } from 'node:util';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, load, loadDomInPage } from './yt-probe.mjs';
import { loadAtPeace, CORE_SCRIPTS, SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS } from '../tests/unit/_load.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SNAPSHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'research');
const DEFAULT_PROFILE = join(homedir(), '.cache', 'at-peace', 'yt-profile');
const AREA_LIMIT = 0.6;
/**
 * Settings whose whole point is to blank most of the page (the feed, the Shorts player, a channel's Home rows,
 * the comments when the page is scrolled down to them).
 */
const BROAD_BY_DESIGN = new Set(['yt.home.feedMode', 'yt.shorts.mode', 'yt.channel.hideHomeShelves', 'yt.home.hideOtherShelves', 'yt.comments.hideAll']);

// ---------------------------------------------------------------------------------------------
// Which snapshot / live page is which YouTube page type (AP.yt.page.TYPES)
// ---------------------------------------------------------------------------------------------

/** Snapshot file stem → page type. */
function pageOfSnapshot(name) {
  if (name.startsWith('home')) return 'home';
  if (name.startsWith('search')) return 'search';
  if (name.startsWith('channel')) return 'channel';
  if (name.startsWith('watch')) return 'watch';
  if (name.startsWith('feed-subscriptions')) return 'subscriptions';
  if (name.startsWith('feed-history')) return 'history';
  if (name.startsWith('feed-you')) return 'you';
  if (['shorts', 'playlist', 'hashtag'].includes(name)) return name;
  return 'other';
}

/** Representative live pages (one load each); the same pages the research snapshots were taken from. */
const LIVE_PAGES = [
  { name: 'home', url: '/' },
  { name: 'search-lofi', url: '/results?search_query=lofi' },
  { name: 'search-rice', url: '/results?search_query=how+to+cook+rice' },
  { name: 'channel-home', url: '/@MrBeast' },
  { name: 'channel-videos', url: '/@MrBeast/videos' },
  { name: 'shorts', url: '/shorts/C0STkNVChLI' },
  { name: 'watch-chapters', url: '/watch?v=CFGLoQIhmow' },
  { name: 'watch-playlist', url: '/watch?v=LxQBJdyOvfc&list=PLsyeobzWxl7omDoEYrrf3oXvXxa6MPgek' },
  { name: 'playlist', url: '/playlist?list=PLsyeobzWxl7omDoEYrrf3oXvXxa6MPgek' },
  { name: 'hashtag', url: '/hashtag/cooking' },
  { name: 'feed-subscriptions', url: '/feed/subscriptions' },
];

// ---------------------------------------------------------------------------------------------
// Reading the catalog
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Entry
 * @property {string} id         setting id ("yt.watch.hideRelated", or "yt.general.thumbnails=blur" for a select value)
 * @property {string} setting    setting id
 * @property {string} selector   what is evaluated with querySelectorAll
 * @property {string} source     the selector as written in the schema
 * @property {string|null} page  page type the setting is scoped to, null = every page
 * @property {boolean} removes   the rule hides content (display:none / visibility:hidden)
 * @property {boolean} root      the rule targets <html> itself (grayscale): nothing to count
 */

/** Pulls `selector { declarations }` blocks out of one compiled-style rule string. */
function parseRule(rule) {
  const text = rule.trim();
  const body = text.startsWith('@') ? text.slice(text.indexOf('{') + 1, text.lastIndexOf('}')) : text;
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].trim(), declarations: m[2].toLowerCase() }));
}

/** Turns the selector side of a `:scope-on …` rule into something querySelectorAll can run. */
function ruleSelector(part) {
  let rest = part.trim();
  if (rest.startsWith(':scope-on')) rest = rest.slice(':scope-on'.length);
  // Extra conditions on <html> itself (`:scope-on[data-at-peace~="x"] ytd-watch-flexy …`).
  while (rest.startsWith('[')) rest = rest.slice(rest.indexOf(']') + 1);
  return rest.replace(/::(before|after)\s*$/, '').replaceAll(':hover', '').trim();
}

function collectEntries(AP) {
  const S = AP.schema;
  /** @type {Entry[]} */
  const entries = [];
  const add = (def, id, source, kind, removes, extra = {}) => {
    entries.push({ id, setting: def.id, selector: source, source, page: def.page ?? null, removes, root: false, kind, ...extra });
  };
  for (const def of S.all()) {
    if (S.siteOf(def.id) !== 'youtube') continue;
    const blocks = def.type === 'select' ? Object.entries(def.variants ?? {}) : [[null, { hide: def.hide, rules: def.rules }]];
    for (const [value, block] of blocks) {
      const id = value === null ? def.id : `${def.id}=${value}`;
      for (const sel of block.hide ?? []) add(def, id, sel, 'hide', true);
      for (const rule of block.rules ?? []) {
        for (const { selectors, declarations } of parseRule(rule)) {
          const removes = /display\s*:\s*none|visibility\s*:\s*hidden/.test(declarations);
          for (const part of S.splitSelectorList(selectors)) {
            const selector = ruleSelector(part);
            const source = part.replace(':scope-on', '').trim() || '(the page itself)';
            if (selector === '') entries.push({ id, setting: def.id, selector: '', source: `:scope-on ${declarations.trim()}`, page: def.page ?? null, removes, root: true, kind: 'rule' });
            else entries.push({ id, setting: def.id, selector, source: `rule: ${source}`, page: def.page ?? null, removes, root: false, kind: 'rule' });
          }
        }
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// In-page inspection (serialised into the browser: must be self-contained)
// ---------------------------------------------------------------------------------------------

/**
 * Counts matches for each selector; reports elements that must never match and, with `withArea`,
 * the share of the viewport covered by the matches' boxes.
 * @param {{ selectors: string[], withArea: boolean }} arg
 */
function inspectInPage({ selectors, withArea }) {
  const GRID_X = 64;
  const GRID_Y = 36;
  const forbidden = (el) => {
    if (el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    if (el.matches('ytd-app')) return 'ytd-app';
    if (el.matches('ytd-app > #content')) return '#content';
    if (el.matches('ytd-page-manager')) return 'ytd-page-manager';
    return null;
  };
  const out = {};
  for (const sel of selectors) {
    try {
      const els = [...document.querySelectorAll(sel)];
      const danger = new Set();
      for (const el of els) {
        const hit = forbidden(el);
        if (hit) danger.add(hit);
      }
      let area = null;
      if (withArea && els.length) {
        const cells = new Set();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        for (const el of els) {
          // A closed drawer is a full-screen host with visibility:hidden; what cannot be seen does not count.
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.opacity === '0') continue;
          for (const r of el.getClientRects()) {
            const x0 = Math.max(0, r.left);
            const x1 = Math.min(vw, r.right);
            const y0 = Math.max(0, r.top);
            const y1 = Math.min(vh, r.bottom);
            if (x1 <= x0 || y1 <= y0) continue;
            for (let gx = Math.floor((x0 / vw) * GRID_X); gx <= Math.min(GRID_X - 1, Math.floor((x1 / vw) * GRID_X - 1e-9)); gx++) {
              for (let gy = Math.floor((y0 / vh) * GRID_Y); gy <= Math.min(GRID_Y - 1, Math.floor((y1 / vh) * GRID_Y - 1e-9)); gy++) cells.add(gx * GRID_Y + gy);
            }
          }
        }
        area = cells.size / (GRID_X * GRID_Y);
      }
      out[sel] = { total: els.length, danger: [...danger], area };
    } catch (err) {
      out[sel] = { error: String(err.message || err).split('\n')[0] };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gathering results
// ---------------------------------------------------------------------------------------------

async function inspectSnapshots(page, files, selectors) {
  const results = [];
  for (const file of files) {
    const name = basename(file).replace(/\.dom\.json$/, '');
    await page.goto('about:blank');
    await page.evaluate(loadDomInPage, await readFile(file, 'utf8'));
    results.push({ name, page: pageOfSnapshot(name), counts: await page.evaluate(inspectInPage, { selectors, withArea: false }) });
  }
  return results;
}

async function inspectLive(page, selectors, pauseSec, log) {
  const results = [];
  for (const spec of LIVE_PAGES) {
    if (results.length) await page.waitForTimeout(pauseSec * 1000);
    log(`load ${spec.name}  ${spec.url}`);
    const ok = await load(page, `https://www.youtube.com${spec.url}`, { wait: 9000, scroll: 2 });
    if (!ok) {
      log('Google served the /sorry/ captcha; stopping early. Wait ~5 minutes and run again.');
      break;
    }
    results.push({ name: spec.name, page: pageOfSnapshot(spec.name), counts: await page.evaluate(inspectInPage, { selectors, withArea: true }) });
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const code = (text) => `\`${cell(text).replaceAll('`', "'")}\``;
const short = (text, n = 150) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function analyse(entries, results) {
  /** @type {any[]} */
  const rows = [];
  for (const e of entries) {
    const row = { ...e, matches: 0, seenOn: [], invalid: null, danger: new Map(), bigArea: null };
    if (e.root) {
      rows.push({ ...row, matches: 1, status: 'ok', note: 'styles the page root' });
      continue;
    }
    const expected = results.filter((r) => e.page === null || r.page === e.page);
    for (const r of results) {
      const c = r.counts[e.selector];
      if (!c) continue;
      if (c.error) row.invalid ??= c.error;
      // Margin fixes and filters may legitimately target page containers; only rules that remove content are judged.
      if (e.removes) for (const d of c.danger ?? []) row.danger.set(d, [...(row.danger.get(d) ?? []), r.name]);
      if (e.removes && c.area !== null && c.area !== undefined && c.area > AREA_LIMIT) {
        if (BROAD_BY_DESIGN.has(e.setting)) row.note = `covers ${Math.round(c.area * 100)}% of the screen on ${r.name} (by design)`;
        else row.bigArea = { page: r.name, area: c.area };
      }
      if (expected.includes(r) && c.total > 0) {
        row.matches += c.total;
        row.seenOn.push(`${r.name} ${c.total}`);
      }
    }
    row.expectedPages = expected.map((r) => r.name);
    row.status = row.invalid ? 'invalid' : row.matches > 0 ? 'ok' : 'zero';
    row.note ||= '';
    if (row.status === 'zero') {
      if (e.selector.includes('data-at-peace-')) row.note = 'set by the page bridge at runtime';
      else if (expected.length === 0) row.note = `no ${e.page} page captured`;
    }
    rows.push(row);
  }
  return rows;
}

function buildReport({ rows, results, mode, entries, defs, notesBySetting }) {
  const valid = rows.filter((r) => r.status !== 'invalid');
  const ok = rows.filter((r) => r.status === 'ok').length;
  const zero = rows.filter((r) => r.status === 'zero').length;
  const invalid = rows.filter((r) => r.status === 'invalid');
  const danger = rows.filter((r) => r.danger.size > 0 || r.bigArea);
  const settingsWithSelectors = new Set(entries.map((e) => e.setting));
  const feature = defs.filter((d) => !settingsWithSelectors.has(d.id));

  const lines = [];
  lines.push('# Selector coverage report', '');
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`npm run selectors\` (${mode}). Do not edit by hand.`, '');
  lines.push(`Pages checked (${results.length}): ${results.map((r) => `${r.name} (${r.page})`).join(', ')}.`, '');
  lines.push(
    mode === 'offline'
      ? 'Source: exact DOM snapshots of a **logged-out** browser (`tests/e2e/artifacts/research/*.dom.json`). They carry no CSS, so the "covers more than 60 % of the screen" check only runs with `--live`. Signed-in-only UI (Create button, signed-in sidebar, home feed, subscriptions feed) is not in them.'
      : 'Source: live pages, loaded one at a time with a pause between them. A signed-in profile (`--profile`) covers signed-in UI as well.',
    '',
  );
  lines.push('## Summary', '');
  lines.push('| | count |', '|---|---|');
  lines.push(`| Settings with CSS | ${settingsWithSelectors.size} |`);
  lines.push(`| JS-only settings (no selector) | ${feature.length} |`);
  lines.push(`| Selectors checked | ${rows.length} |`);
  lines.push(`| ✅ matched | ${ok} |`);
  lines.push(`| ⚠️ 0 matches | ${zero} |`);
  lines.push(`| ❌ invalid selector | ${invalid.length} |`);
  lines.push(`| 🚫 matches something it must not | ${danger.length} |`, '');

  if (invalid.length || danger.length) {
    lines.push('## Problems', '');
    for (const r of invalid) lines.push(`- ❌ \`${r.id}\`: ${code(short(r.source))} is invalid (${cell(r.invalid)})`);
    for (const r of danger) {
      const what = [...r.danger.entries()].map(([d, pages]) => `${d} on ${pages.slice(0, 3).join(', ')}`);
      if (r.bigArea) what.push(`${Math.round(r.bigArea.area * 100)}% of the screen on ${r.bigArea.page}`);
      lines.push(`- 🚫 \`${r.id}\`: ${code(short(r.source))} matches ${what.join('; ')}`);
    }
    lines.push('');
  }

  // Per-setting roll-up.
  lines.push('## Settings', '');
  lines.push('A setting is ✅ when at least one of its selectors matched on an expected page, ⚠️ when none did.', '');
  lines.push('| Setting | Page | Selectors | Matched | Status |', '|---|---|---|---|---|');
  const byId = new Map();
  for (const r of rows) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  for (const [id, list] of byId) {
    const matched = list.filter((r) => r.status === 'ok').length;
    const bad = list.some((r) => r.status === 'invalid' || r.danger.size > 0 || r.bigArea);
    const status = bad ? '❌/🚫' : matched > 0 ? '✅' : '⚠️';
    lines.push(`| ${code(id)} | ${list[0].page ?? 'all'} | ${list.length} | ${matched} | ${status} |`);
  }
  for (const d of feature) lines.push(`| ${code(d.id)} | ${d.page ?? 'all'} | – | – | JS (${d.feature}) |`);
  lines.push('');

  // Per-selector table.
  lines.push('## Selectors', '');
  lines.push('| Setting | Selector | Page | Matches | Status | Seen on / note |', '|---|---|---|---|---|---|');
  for (const r of rows) {
    const status = r.status === 'invalid' ? '❌ invalid selector' : r.danger.size > 0 || r.bigArea ? '🚫 too broad' : r.status === 'ok' ? '✅ matched' : '⚠️ 0 matches';
    const seen = r.status === 'invalid' ? cell(r.invalid) : r.seenOn.length ? cell([r.seenOn.slice(0, 3).join(', '), r.note].filter(Boolean).join('; ')) : cell(r.note || notesBySetting.get(r.setting) || '');
    lines.push(`| ${code(r.id)} | ${code(short(r.source, 220))} | ${r.page ?? 'all'} | ${r.matches} | ${status} | ${seen} |`);
  }
  lines.push('');
  return { text: lines.join('\n'), counts: { total: rows.length, ok, zero, invalid: invalid.length, danger: danger.length, valid: valid.length } };
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const { values: o } = parseArgs({
    options: {
      live: { type: 'boolean', default: false },
      pause: { type: 'string', default: '45' },
      profile: { type: 'string', default: DEFAULT_PROFILE },
      snapshots: { type: 'string', default: DEFAULT_SNAPSHOTS },
      out: { type: 'string', default: join(ROOT, 'docs', 'selector-report.md') },
      viewport: { type: 'string', default: '1440x900' },
      headed: { type: 'boolean', default: false },
    },
  });
  const log = (msg) => console.error(`[selectors] ${msg}`);

  const AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS[1]]);
  const problems = AP.schema.validateRegistry();
  if (problems.length) {
    console.error(`validateRegistry() reports ${problems.length} problem(s); fix them first:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const entries = collectEntries(AP);
  const selectors = [...new Set(entries.filter((e) => !e.root).map((e) => e.selector))];
  const defs = AP.schema.all().filter((d) => AP.schema.siteOf(d.id) === 'youtube');

  const snapDir = resolve(o.snapshots);
  const files = existsSync(snapDir) ? (await readdir(snapDir)).filter((f) => f.endsWith('.dom.json')).sort().map((f) => join(snapDir, f)) : [];
  const mode = o.live || files.length === 0 ? 'live' : 'offline';
  if (mode === 'live' && !o.live) log(`no snapshots in ${snapDir}; going live (slow, paced)`);
  log(`${entries.length} rules, ${selectors.length} distinct selectors, ${mode} mode`);

  let results;
  if (mode === 'offline') {
    const { page, close } = await launch({ viewport: o.viewport, offline: true });
    try {
      results = await inspectSnapshots(page, files, selectors);
    } finally {
      await close();
    }
  } else {
    await mkdir(o.profile, { recursive: true });
    const { page, close } = await launch({ profile: o.profile, headed: o.headed, viewport: o.viewport });
    try {
      results = await inspectLive(page, selectors, Number(o.pause), log);
    } finally {
      await close();
    }
    if (results.length === 0) {
      console.error('No live page could be loaded.');
      process.exit(2);
    }
  }

  const rows = analyse(entries, results);
  // Logged-out snapshots cannot see signed-in UI: say so next to settings whose description says that.
  const notesBySetting = new Map(defs.filter((d) => /signed in|signed-in|signed out/.test(d.description ?? '')).map((d) => [d.id, 'signed-in / signed-out UI']));
  const { text, counts } = buildReport({ rows, results, mode, entries, defs, notesBySetting });
  await mkdir(dirname(o.out), { recursive: true });
  await writeFile(o.out, text);
  console.log(`${counts.total} selectors: ${counts.ok} matched, ${counts.zero} with 0 matches, ${counts.invalid} invalid, ${counts.danger} too broad -> ${o.out}`);
  if (counts.invalid || counts.danger) process.exitCode = 1;
}

await main();
