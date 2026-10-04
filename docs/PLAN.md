# At Peace — Master Plan

> A calm, intentional YouTube. A Firefox / Zen Browser extension that lets you hide
> every part of YouTube you don't want to see, and adds a little friction (a breath,
> a timer, a schedule) between you and the feed.
>
> v1 scope: **YouTube only** (www.youtube.com, desktop). Architecture is ready for
> more sites later (see [Future](#11-future-other-sites--ideas)).

This document is the single source of truth for every agent working on the codebase.
Read it fully before writing code. When something here conflicts with your instinct,
follow this document and raise the conflict in your report.

---

## 0. Product summary

| Pillar | What it does | Inspired by |
|---|---|---|
| **Declutter** | ~150 granular toggles to hide any YouTube element (feeds, Shorts, comments, sidebar, buttons, metrics, AI features, player overlays…), thumbnail modes, grayscale, keyword/channel filters, custom hide rules via an element picker. | Untrap, SocialFocus, Unhook |
| **Redirect** | Home → Subscriptions / Watch Later / custom; Shorts → normal player or blocked; channel → Videos tab. | Untrap |
| **Behave** | Autoplay off, no auto-start, auto theater, default speed, dismiss "Still watching?". | Untrap Plus |
| **Mindful Pause** | one-sec style breather: opening YouTube (or any site you add) shows a breathing screen, your open count, an optional intention prompt, then "Close it" or "Continue for N min". Session expiry brings the pause back. | one sec |
| **Focus** | One-click "Block YouTube for 25 min / 1 h / 4 h / rest of day", weekly schedules (block or apply a preset), daily time limit, local usage stats. | Untrap, one sec |
| **Own it** | Presets (built-in + custom), import/export, settings lock (password or friction), keyboard shortcuts, onboarding. | Untrap, SocialFocus |

Non-goals for v1: AI summaries/transcripts (explicitly unwanted), cloud sync / accounts,
m.youtube.com and music.youtube.com, Instagram/X/LinkedIn, any network calls of our own.

Privacy: **nothing ever leaves the browser.** No analytics, no remote fonts, no remote code.
Manifest declares `data_collection_permissions: { required: ["none"] }`.

---

## 1. Platform decisions

- **Target**: Firefox Manifest V3, `strict_min_version: "140.0"` (Zen tracks current Firefox;
  140 is the ESR baseline and supports everything we use: `world: "MAIN"` content scripts,
  DNR with `regexSubstitution`, `:has()`, `storage.session`, `data_collection_permissions`).
- **Gecko id**: `at-peace@cristianbagrin` (needed for signing; never change it).
- **Chrome compatibility (testing only)**: the shipped manifest is Firefox-first. The test
  harness generates a Chrome variant in a temp dir (swaps `background.scripts` for a
  `service_worker` that `importScripts()` the same files) so we can run automated E2E in the
  pre-installed Chromium via Playwright. All code must therefore work with both
  `browser.*` (Firefox) and promise-based `chrome.*` (Chrome MV3) through our shim.
- **No build step.** Plain modern JavaScript (ES2022), JSDoc types, no framework, no bundler.
  What is in `src/` is exactly what ships. This keeps AMO review trivial and the code readable.
- **Installing in Zen**: Zen (like Firefox release) only installs *signed* add-ons permanently.
  - Development: `about:debugging` → *Load Temporary Add-on* → pick `manifest.json`
    (removed on browser restart), or `npm run start:firefox` with `web-ext run`.
  - Permanent: free *unlisted* signing on AMO: `npm run sign` (needs the user's AMO
    API key/secret in `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`) → produces a signed `.xpi`
    the user drags into Zen. This is a user action (needs their Mozilla account).

---

## 2. Repository layout

```
at-peace/
  manifest.json
  package.json                 # devDeps only: web-ext, eslint (+ globals). Scripts below.
  eslint.config.js
  README.md                    # install (Zen), dev workflow, feature list
  PRIVACY.md
  CHANGELOG.md
  docs/
    PLAN.md                    # this file
    youtube-dom.md             # selector research (Phase 1) — kept up to date
    reviews/                   # Opus review notes per phase
  src/
    shared/                    # classic scripts, loaded in EVERY context (see §3.1)
      namespace.js             # globalThis.AtPeace = {} (must load first)
      browser-api.js           # AP.api = globalThis.browser ?? globalThis.chrome
      util.js                  # small helpers: debounce, rafThrottle, dayKey, clamp, uid, escapeHtml…
      schema-core.js           # registry + validation + CSS compiler (§4)
      schema/                  # cross-site settings
        general.js             # master switch, theme, etc.
        pause.js               # Mindful Pause settings
        focus.js               # blocks, schedules, daily limit
        advanced.js            # custom rules, custom CSS, lock, shortcuts
      presets.js               # built-in presets + helpers (§5.3)
      settings.js              # storage access: load/save/merge/migrate/subscribe/effective (§5)
      state.js                 # runtime state (sessions, blocks) + stats helpers (§5.4)
      messages.js              # message type constants + sendMessage helper
    sites/
      youtube/
        schema/                # YouTube settings, one file per section (§6)
          general.js masthead.js guide.js home.js watch.js player.js comments.js
          search.js shorts.js subscriptions.js channel.js filters.js
        page.js                # page-type detection for YouTube URLs
        features/              # JS behaviours (§7)
          home-feed.js shorts.js autoplay.js theater.js speed.js still-watching.js
          channel-tab.js filters.js thumbnails-hover.js calm-titles.js
          session-guard.js     # pause-session expiry overlay + block enforcement on open tabs
          time-tracker.js      # heartbeat for daily limit / stats
        page-bridge.js         # MAIN-world script (player API calls), tiny, message-based
        main.js                # wires engine + features for YouTube
    content/
      engine.js                # site-agnostic: style injection, html attributes, nav + mutation bus
      overlay.js               # closed-shadow-DOM overlay helper (session expiry, block notice)
      picker.js                # element picker (Phase 4)
      guard.js                 # tiny content script for user-added pause/block sites (Phase 3c)
    background/
      background.js            # entry: install/update, message router, alarms
      rules.js                 # DNR "rules compiler": settings+state → dynamic rules (§8)
      sessions.js              # pause sessions, focus blocks, schedules, limits
      stats.js                 # aggregate heartbeats + pause outcomes into daily stats
      sw-chrome.js             # Chrome test-only service worker: importScripts(...) same files
    pages/
      common/
        tokens.css             # design tokens (§9)
        base.css               # resets, typography, native control styling
        components.js          # tiny DOM helpers shared by pages (h(), toggle row, etc.)
      popup/      popup.html popup.css popup.js
      options/    options.html options.css options.js  (+ options/*.js modules)
      pause/      pause.html pause.css pause.js
      blocked/    blocked.html blocked.css blocked.js
      welcome/    welcome.html welcome.css welcome.js   (onboarding, Phase 4)
  icons/                       # icon.svg + generated PNGs 16/32/48/96/128
  tests/
    unit/                      # node:test, no deps — load classic scripts into globalThis
    e2e/                       # Playwright (global install at /opt/node22/lib/node_modules/playwright)
      harness.mjs              # builds Chrome variant, launches persistent context with extension
      *.spec.mjs
    firefox/                   # Selenium + geckodriver smoke test in real Firefox (Phase 0)
  tools/
    yt-probe.mjs               # dump YouTube DOM outlines (research)
    check-selectors.mjs        # live selector coverage report for every schema selector
    make-icons.mjs
```

### package.json scripts (contract)

| script | does |
|---|---|
| `npm run lint` | `eslint .` + `web-ext lint --self-hosted` (0 errors required; warnings reviewed) |
| `npm test` | `node --test tests/unit/` |
| `npm run e2e` | Playwright E2E in Chromium (extension pages + local fixtures + live YouTube smoke) |
| `npm run test:firefox` | real-Firefox smoke test (Selenium + geckodriver, headless) |
| `npm run selectors` | `node tools/check-selectors.mjs` live coverage report → `docs/selector-report.md` |
| `npm run start:firefox` | `web-ext run` |
| `npm run build` | `web-ext build` → `web-ext-artifacts/at-peace-<version>.zip` |
| `npm run sign` | `web-ext sign --channel=unlisted` (user supplies keys) |

---

## 3. Code conventions (all agents)

### 3.1 Module pattern — shared code is classic scripts

Content scripts cannot be ES modules, and we have no bundler. Therefore **everything in
`src/shared/`, `src/sites/**`, `src/content/` and `src/background/` is a classic script** that
attaches to a single namespace:

```js
// src/shared/util.js
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.util = { debounce, dayKey, /* … */ };
  function debounce(fn, ms) { /* … */ }
})();
```

- `namespace.js` loads first everywhere and does `globalThis.AtPeace ??= {}`.
- Load order is declared explicitly in: `manifest.json` (content_scripts, background.scripts),
  every page's `<script>` tags, `background/sw-chrome.js`, and `tests/unit/_load.mjs`.
  **When you add a shared/background/content file, update every list that needs it.**
- Page-specific code (`src/pages/<page>/*.js`) MAY be ES modules (`<script type="module">`)
  that read `globalThis.AtPeace` populated by earlier classic `<script>` tags.
- No top-level `await`, no `import`/`export` in classic files.
- Unit tests load classic files with a helper that `await import()`s them in order
  (they only mutate `globalThis`), then read `globalThis.AtPeace`.

### 3.2 Style

- `'use strict'`, `const`/`let`, arrow functions for callbacks, early returns, small functions.
- Comments explain *why*, not *what*. JSDoc on exported functions and on the schema types.
- No `innerHTML` with any non-constant string (AMO flags it, XSS risk). Build DOM with
  `document.createElement` / the `h()` helper. `textContent` for text.
- No `eval`, no `new Function`, no remote resources, no inline `<script>` or inline event
  handlers in HTML (CSP).
- All user-visible strings in English for v1, kept in the files where used (no i18n
  framework yet, but keep strings out of logic so they can be moved to `_locales` later).
- Errors: never let a single failing feature break the rest — the engine wraps each feature
  call in try/catch and logs with the prefix `[At Peace]`.
- Log only behind `AP.debug` (false by default; settable from options "Advanced → Debug logs").

### 3.3 Cross-browser API

`AP.api` is the promise-based extension API (`browser` in Firefox, `chrome` in Chrome MV3).
Never call `chrome.*` or `browser.*` directly. Feature-detect anything optional.

### 3.4 Git

Sub-agents **do not run git commands that change state** (no add/commit/checkout/stash).
Opus reviews and commits after each phase. Agents work in the shared working tree on
**disjoint files** listed in their brief; if you must touch a file outside your list, say so
in your report rather than editing it (exception: the load-order lists in §3.1, which you must
keep correct — mention every such edit in your report).

### 3.5 Quality bar ("done" means)

- `npm run lint` and `npm test` pass; new logic has unit tests.
- Your feature is exercised end-to-end at least once (Playwright in Chromium, or live probe)
  and you report what you actually observed (screenshots in `tests/e2e/artifacts/` are welcome,
  they are git-ignored).
- No console errors from our code on YouTube pages, popup, options.
- Report honestly: what works, what you could not verify (e.g. logged-in-only UI), known gaps.

---

## 4. Settings schema (the heart of the extension)

Every user-facing option is declared once, in a schema file. From the schema we derive:
defaults, the options UI, popup quick toggles, presets, CSS hide rules, search, and validation.

### 4.1 Setting definition

```js
/**
 * @typedef {Object} SettingDef
 * @property {string} id            Stable key. Site settings are prefixed: 'yt.home.hideChips'.
 *                                  Cross-site: 'pause.enabled', 'focus.dailyMinutes'.
 *                                  NEVER rename an id after release (migrations only).
 * @property {string} section       Section id (registered via AP.schema.section()).
 * @property {string} [group]       Sub-heading inside the section ("Sidebar", "Below the video").
 * @property {string} label         Short, plain: "Hide comments".
 * @property {string} [description] One sentence, what exactly disappears / happens.
 * @property {'toggle'|'select'|'number'|'text'|'textarea'|'list'|'object'} type
 * @property {*} default
 * @property {{value:string,label:string}[]} [options]   for 'select'
 * @property {number} [min] @property {number} [max] @property {number} [step]  for 'number'
 * @property {string} [unit]        'seconds' | 'minutes' | '%' … (UI only)
 * @property {string[]} [tags]      bulk-action groups: 'shorts','recommendations','comments',
 *                                  'ai','metrics','ads','clutter','player','behaviour'
 * @property {string} [page]        YouTube page type that scopes the CSS (see §6.1). Omit = all pages.
 * @property {string[]} [hide]      (toggle) CSS selectors set to display:none when ON.
 * @property {Object<string,{hide?:string[], rules?:string[]}>} [variants]
 *                                  (select) per-value CSS. Key = option value.
 * @property {string[]} [rules]     (toggle) full CSS rules with the placeholder `:scope-on`
 *                                  e.g. ':scope-on ytd-thumbnail img { filter: blur(12px) }'.
 *                                  The compiler replaces `:scope-on` with the gating prefix.
 * @property {string} [feature]     Name of the JS feature that reads this setting (docs + tests).
 * @property {string} [requires]    Another setting id that must be truthy for this to matter
 *                                  (UI shows this row disabled otherwise).
 * @property {boolean} [advanced]   Hidden behind "Show advanced" in the UI.
 * @property {boolean} [quick]      Offered as a popup quick toggle.
 * @property {string} [since]       Version added (e.g. '0.1.0').
 */
```

Sections: `AP.schema.section({ id, site, title, icon?, order, description })`.
Registration: `AP.schema.define(sectionId, [ ...SettingDef ])`.

`schema-core.js` provides:
- `AP.schema.all()`, `get(id)`, `sections()`, `bySection(id)`, `byTag(tag)`, `defaults()`.
- `validateValue(def, value)` → coerced valid value or the default (never throws).
- `validateRegistry()` → array of problems (duplicate ids, bad defaults, select default not in
  options, unknown section, missing label, `hide` on non-toggle…). Unit-tested; called by tests,
  never at runtime in production paths.
- `compileCss(site)` → one stylesheet string for that site (see 4.2).
- `tokensFor(effectiveSettings, site)` → array of active tokens (see 4.2).

### 4.2 How CSS hiding works (no flicker, cheap toggling)

The content script injects **one static `<style>` at `document_start`** compiled from the schema.
Every rule is gated by a token on `<html>`:

```css
html[data-at-peace~="yt.home.hideChips"] ytd-browse[page-subtype="home"] #chips-wrapper { display: none !important; }
html[data-at-peace~="yt.general.thumbnails=blur"] … { filter: blur(14px) !important; }
html[data-at-peace-page="watch"][data-at-peace~="yt.watch.hideRelated"] #related { display:none !important; }
```

- `data-at-peace` = space-separated list of active tokens. Toggles produce their `id`;
  selects produce `id=value`. Turning a setting on/off is a single attribute write — instant,
  no style recompute of our sheet, works on content that loads later (infinite scroll, SPA nav).
- `data-at-peace-page` = current YouTube page type (§6.1), maintained by the engine.
- **One rule per selector** (never a selector list) so one invalid/unsupported selector can't
  void the others.
- When `general.enabled` is false the token list is emptied → YouTube is untouched.
- Selector robustness rules (see §6.2) are mandatory.

### 4.3 Effective settings

`effective = validate(defaults ⊕ stored ⊕ activeOverride)` where `activeOverride` is the value
map of a preset applied by an active schedule (§8.4) or `null`. Computed by
`AP.settings.effective()`; content scripts and background use the same function.

---

## 5. Storage model (`storage.local`)

| key | shape | written by |
|---|---|---|
| `settings` | `{ [id]: value }` — only values that differ from default are required, but full maps are fine | options, popup, welcome |
| `customPresets` | `[{ id, name, values: {[id]: value}, createdAt }]` | options |
| `state` | `{ sessions: {[siteKey]: untilMs}, block: {until, reason, siteKeys[]}\|null, extraTime: {[day]: minutes}, scheduleOverride: presetId\|null }` | background (only) |
| `stats` | `{ [YYYY-MM-DD]: { [siteKey]: { activeSec, opens, turnedBack, continued, blockedHits } } }` (keep 90 days) | background (only) |
| `meta` | `{ schemaVersion, installedAt, onboarded, lastVersion }` | background |

- `AP.settings.load()`, `save(patch)` (read-modify-write, validated), `reset(ids?)`,
  `subscribe(cb)` (wraps `storage.onChanged`, debounced 50 ms, calls back with new effective).
- Migrations: `AP.settings.migrate(stored, fromVersion)` — a list of pure functions. Start at 1.
- **Only the background writes `state` and `stats`** (pages/content send messages) to avoid
  write races.
- `siteKey`: `'youtube'` for the built-in site; user-added sites use their registrable domain
  (`'reddit.com'`).

### 5.3 Presets

Built-in (read-only, in `presets.js`): values are *partial* maps applied on top of defaults
(applying a preset = `settings := defaults ⊕ preset.values`, after a confirmation).

| preset | intent |
|---|---|
| **Gentle** (default on install) | Hide ads, Shorts everywhere, AI features, Premium upsells, clutter in the masthead/guide. Feeds stay. |
| **Focused** | Gentle + home feed hidden (calm placeholder), related videos, end screens, comments hidden, autoplay off, no hover previews. |
| **Deep work** | Focused + home redirect to Subscriptions, search shelves/related searches hidden, metrics hidden, thumbnails blurred, grayscale, Mindful Pause on. |
| **Untouched** | Nothing hidden (everything default off). |

Custom presets: "Save current as preset", rename, delete, apply, export with settings.

### 5.4 Stats & time

`dayKey` uses the **local** date. Active time = YouTube tab visible **and** (window focused or
video playing), counted by 30 s heartbeats from `time-tracker.js` (background adds
`min(delta, 35)` seconds per heartbeat to avoid double counting across tabs: per-site last-beat
timestamp, ignore beats closer than 25 s apart).

---

## 6. YouTube settings catalog

Section order in the options page, with the settings each must contain. Selectors are
researched in Phase 1 (`docs/youtube-dom.md`) and filled in by Phase 2. Defaults below are
for the *Untouched* baseline (everything off) — the install default is the *Gentle* preset
applied on first run. ★ = popup quick toggle candidate. Tags in brackets.

### 6.1 Page types (`AP.yt.page.detect(url)` → `data-at-peace-page`)

`home` (`/`), `watch` (`/watch`), `search` (`/results`), `shorts` (`/shorts/…`),
`subscriptions` (`/feed/subscriptions`), `channel` (`/@x`, `/channel/…`, `/c/…`, `/user/…`
incl. sub-tabs), `playlist` (`/playlist`), `history`, `library`/`you` (`/feed/you`,
`/feed/library`), `explore` (`/feed/trending`, `/feed/explore`, `/gaming`, `/feed/…` hubs),
`other`.

### 6.2 Selector robustness rules

1. Prefer YouTube's custom element tags + stable ids/attributes (`ytd-watch-flexy #related`,
   `ytd-browse[page-subtype="home"]`, `[is-shorts]`, `a[href^="/shorts/"]`) over generated
   class names. The new view-model components (`yt-lockup-view-model`,
   `ytm-shorts-lockup-view-model`, `grid-shelf-view-model`, `.ytLockupViewModel…`) use stable
   BEM-like class names — acceptable.
2. **Never match on visible text or `aria-label` text** (users run YouTube in many languages).
   Exception: none. Use hrefs, icons' `d`/`icon` attributes only as a last resort.
3. Always include both the legacy renderer and the current view-model variant when both exist.
4. `:has()` is allowed (Firefox 121+) but anchor it to a specific element
   (`ytd-rich-item-renderer:has(a[href^="/shorts/"])`), never `*:has(…)` or `div:has(…)`.
5. Hiding a container must not leave holes (e.g. hide the grid row's item, not the inner
   thumbnail; collapse shelf margins).
6. Each selector carries a comment in `docs/youtube-dom.md`: where it was observed, date, and
   whether it is verified live (logged-out) or from public sources (logged-in-only UI).

### 6.3 Sections and settings

**General** (`yt.general.*`)
- master switch `general.enabled` ★ and `general.theme` (`light` | `dark` | `system`, default `light`) are cross-site and live in `src/shared/schema/general.js`
- `grayscale` ★ — whole site in grayscale [behaviour]
- `thumbnails` ★ select: `show` | `blur` (reveal on hover) | `grayscale` | `hide` [recommendations]
- `disableHoverPreview` — no inline video playback when hovering thumbnails [behaviour]
- `hideViewCounts` (feeds/cards) [metrics] · `hideUploadDates` [metrics] · `hideDurations` · `hideChannelAvatars` · `hideBadges` (New/4K/CC/Verified chips in cards)
- `hideWatchedProgress` (red resume bar) · `hideWatched` (whole cards already watched)
- `hideAds` ★ promoted/sponsored cards, masthead ad, in-feed ad slots, companion ads [ads]
- `hidePremiumUpsells` (Premium/Music/TV promos, mealbars) [ads]
- `hideMixes` (YouTube "Mix" playlists in any feed) [recommendations]
- `hidePlayables` [clutter] · `hideLiveBadgesAndPremieres`? (only if cheap)
- `calmTitles` select: `off` | `sentence` (Shouting WORDS → normal case) [behaviour, JS]

**Top bar** (`yt.masthead.*`)
- `hideCreate` · `hideNotifications` · `hideVoiceSearch` · `hideSearchSuggestions` (autocomplete dropdown; rabbit-hole) · `hideSearchBar` (advanced) · `hideCountryCode` · `hideDoodle` (animated logo) · `hideAICompanion` [ai] · `hideMastheadAd` [ads] · `hideGuideButton` (burger)

**Left sidebar** (`yt.guide.*`)
- `hideAll` (full + mini guide) · `hideMini` · entries: `hideHome`, `hideShorts` [shorts], `hideSubscriptionsEntry`, `hideYouEntry`, `hideHistory`, `hidePlaylists`, `hideYourVideos`, `hideWatchLater`, `hideLiked`, `hideDownloads`, `hideCourses` ·
  sections: `hideSubscriptionsSection` (channel list) · `hideExploreSection` (Trending/Music/Gaming/News/…) · `hideMoreFromYouTube` · `hideSettingsSection` · `hideFooter` · `hideSignInPromo`

**Home** (`yt.home.*`, page `home`)
- `feedMode` ★ select: `show` | `hide` (calm placeholder, JS) | `subscriptions` | `watchLater` | `playlists` | `custom` (the last four redirect: DNR for full loads, JS for in-app navigation) [recommendations]
- `redirectUrl` (text, requires feedMode=custom; validate same-origin youtube path or full https URL)
- `hideChips` (category bar) · `hideShortsShelf` [shorts] · `hideNewsShelf` · `hidePostsShelf` (community posts) · `hideOtherShelves` (all rich sections: trending, explore topics, playables, "Previously watched"…) · `hideFeedNudge` (logged-out "try searching") · `limitRows`? (advanced, number; 0=off; only if CSS-only via nth-child is reliable)

**Video page** (`yt.watch.*`, page `watch`)
- Sidebar group: `hideRelated` ★ [recommendations] · `hideRelatedShorts` [shorts] · `hideRelatedChips` · `hideLiveChat` · `hidePlayerAds` [ads] · `hideShoppingShelf`/`hideMerch` · `hideTickets`
- Below the video group: `hideHashtags` · `hideOwnerAvatar` · `hideSubscriberCount` [metrics] · `hideJoinButton` · `hideLikeCounts` [metrics] · `hideLikeButtons` · `hideShare` · `hideDownload` · `hideClip` · `hideThanks` · `hideSave` · `hideAsk` [ai] · `hideMoreActions` · `hideViewCount` [metrics] · `hideDescription` · `hideAISummary` [ai] · `hideChapters` (key moments carousel in description) · `hideDescriptionExtras` (music/transcript/podcast/game/people/places/courses cards) · `hideInfoPanels` (context / clarify boxes) · `hideFundraiser`
- Comments live in their own section (below)
- Behaviour group (JS): `disableAutoplay` ★ (autoplay-next off) [behaviour, recommendations] · `noAutoStart` (don't start playback on page open) · `autoTheater` · `defaultSpeed` select (`default`, 0.75, 1, 1.25, 1.5, 1.75, 2) · `dismissStillWatching` · `hideAmbientMode` (cinematics glow; CSS)

**Player** (`yt.player.*`, page `watch` — but player also appears in channel trailers/miniplayer: omit `page` where needed)
- `hideEndscreenCards` (overlay cards in last 20 s) [recommendations] · `hideEndscreenWall` (grid of suggestions at the end) ★ [recommendations] · `hideInfoCards` · `hidePauseOverlay` (embed "More videos") · `hideWatermark` · `hidePaidPromotion` · `hideAutoplayToggle` · `hideNextButton` · `hideMiniplayerButton` · `hideCastButton` · `hideSubtitlesButton` (advanced) · `hideChapterTitle` · `hideProgressPreviews`? (storyboard thumbnails on hover, advanced)

**Comments** (`yt.comments.*`, applies to watch + shorts + posts)
- `hideAll` ★ [comments] · `hideTeaser` (comment teaser under description) · `hideCount` [metrics] · `hideAvatars` · `hideLikeCounts` [metrics] · `hideReplies` (collapse reply threads) · `hideCreatorHearts`? (advanced)

**Search** (`yt.search.*`, page `search`)
- `hideShorts` [shorts] · `hideShelves` (People also watched / For you / Previously watched / Channels new to you / Latest from…) [recommendations] · `hideRelatedSearches` · `hideAds` [ads] · `hideSnippets` (description snippets) · `hideFilterChips` · `hideChannelResults`? (advanced)

**Shorts** (`yt.shorts.*`)
- `mode` ★ select: `allow` | `watch` (open Shorts in the normal player; DNR + JS) | `block` (calm "Shorts are off" page) [shorts]
- When allowed, on the Shorts player: `hideComments` `hideLikeCounts` (metrics) `hideRemix` `hideSubscribe` — keep small.

**Subscriptions** (`yt.subs.*`, page `subscriptions`)
- `hideShorts` [shorts] · `hidePosts` · `hideLive` · `hideUpcoming` (premieres/scheduled) · `hideWatched`

**Channel** (`yt.channel.*`, page `channel`)
- `openVideosTab` (redirect channel root to `/videos`, JS) · `hideTrailer` (no autoplaying featured video) · `hideHomeShelves` · `hideShortsTab` [shorts] · `hidePostsTab` · `hideStoreTab` · `hideSubscriberCount` [metrics] · `hideBanner`

**Filters** (`yt.filters.*`, JS)
- `keywords` (list of strings; `/regex/flags` allowed) · `channels` (list of names or @handles) · `applyTo` (multi: home, search, watch sidebar, subscriptions) · `commentKeywords` (list)
- Filtered cards get `data-at-peace-filtered` and are hidden by CSS. Matching is case-insensitive, diacritic-insensitive; regex compile errors are shown in the UI, never thrown at runtime.

**Advanced** (`advanced.*`)
- `customRules` (list of `{ id, selector, page|null, note, createdAt }` from the picker) · `customCss` (textarea, sanitized: no `@import`, no `url(` to remote) · `debug`.

Bulk actions (options toolbar + popup): **Shorts**, **Recommendations**, **Comments**, **AI**,
**Metrics**, **Ads**, **Clutter** → set every toggle with that tag ON/OFF (selects with that tag
go to their "most hidden" value; define per setting via `bulkValue` in the def if needed).

---

## 7. Content-side engine (`src/content/engine.js`)

```
AP.engine.start({ site: 'youtube', detectPage, features })
```

1. At `document_start`: inject `<style id="at-peace-style">` with `AP.schema.compileCss(site)`
   into `document.documentElement` (re-insert if removed). Set `data-at-peace-page`.
2. Load effective settings (async, a few ms). Write `data-at-peace` tokens.
   Also inject a second `<style id="at-peace-dynamic">` for dynamic CSS (custom rules,
   custom CSS, numeric settings).
3. Subscribe to settings changes → recompute tokens, dynamic CSS, notify features.
4. Navigation: listen to `yt-navigate-start`, `yt-navigate-finish`, `yt-page-data-updated`,
   `popstate`; also poll `location.href` cheaply on `yt-navigate-finish` fallbacks. Update
   `data-at-peace-page`, call `feature.onNavigate(ctx)`.
5. Mutation bus: **one** `MutationObserver` on `document` (childList+subtree), batched per
   animation frame, only active if at least one feature declares `observes: true` *and* is
   enabled. Features receive the batch's added element roots.
6. Feature interface:
   ```js
   { id, settings: ['yt.watch.disableAutoplay', …], observes?: boolean,
     init?(ctx), onSettings?(ctx, changedIds), onNavigate?(ctx), onMutations?(ctx, addedRoots),
     destroy?() }
   ```
   `ctx = { settings (effective), page, url, api: AP.api, bridge, log }`.
   A feature is "enabled" when any of its settings is truthy and not `'show'/'allow'/'default'/'off'`
   — or let the feature decide in `isActive(ctx)`.
7. Every feature call is wrapped in try/catch.

`page-bridge.js` (MAIN world) exposes a tiny command channel via `window.postMessage` with a
random-nonce handshake: `setAutonav(bool)`, `setPlaybackRate(n)`, `pauseVideo()`,
`getPlayerState()`. It must not touch anything else and must ignore messages without the nonce.
Use the bridge only where DOM-level approaches are unreliable.

---

## 8. Background (`src/background/`)

Firefox MV3 background = non-persistent event page. **No in-memory state that matters**; read
from storage on each event. Use `alarms` for anything in the future.

### 8.1 Message router (`messages.js` constants)

`PAUSE_CONTINUE {siteKey, minutes, intention}`, `PAUSE_TURN_BACK {siteKey}`, `PAUSE_OPENED {siteKey}`,
`FOCUS_START {minutes|untilEndOfDay, siteKeys}`, `FOCUS_END`, `HEARTBEAT {siteKey}`,
`CLOSE_TAB` (closes `sender.tab.id`), `GET_STATUS` → `{ block, sessions, today stats, schedule }`,
`OPEN_OPTIONS {section?}`, `START_PICKER`.

### 8.2 DNR rules compiler (`rules.js`)

`syncRules()` recomputes all **dynamic** rules from effective settings + state and applies the
diff via `declarativeNetRequest.updateDynamicRules`. Called on install/startup, settings change,
state change, alarm. Rule-id ranges and priorities:

| ids | priority | purpose | condition |
|---|---|---|---|
| 100–199 | 300 | **Block** (focus block / schedule block / daily limit reached) → `blocked.html#<url>` | `main_frame`, per blocked site regex |
| 200–299 | 200 | **Mindful Pause** → `pause.html#<url>` | `main_frame`, per paused site without an active session |
| 300–399 | 100 | **YouTube redirects**: home → target; `/shorts/ID` → `/watch?v=ID`; shorts block → `blocked.html#…`; | `main_frame` |

- Redirect to extension pages uses `regexSubstitution` with
  `AP.api.runtime.getURL('src/pages/pause/pause.html') + '#\\0'` (the original URL travels in the
  hash, unencoded — the page reads `location.hash.slice(1)`).
- YouTube site regex: `^https?://(www\.|m\.)?youtube\.com/` (not music./studio./tv.).
- These pages are in `web_accessible_resources` for `<all_urls>` (required for DNR redirects
  to extension pages).
- SPA navigations inside YouTube never hit DNR; the YouTube content features handle those.

### 8.3 Mindful Pause flow

1. Navigation to a paused site with no active session → DNR → `pause.html#https://…`.
2. Pause page: sends `PAUSE_OPENED` (stats.opens++), shows site, breathing animation
   (`breathSeconds`, default 6, escalates `+escalateStep` s per open in the last hour if
   enabled, capped at 30), then the open counter ("4th time today"), optional intention input,
   and two actions: **Close {site}** (primary visual weight) → `PAUSE_TURN_BACK` then
   history.back() if possible else `CLOSE_TAB`; **Continue for [5|10|15|30|60] min** (enabled only
   after the breath) → `PAUSE_CONTINUE` → background stores `sessions[siteKey] = now+minutes`,
   removes the pause rule, sets alarm `session:<siteKey>`, replies → page does
   `location.replace(target)`.
3. Other tabs sitting on a pause page for the same site update live (storage change) and offer
   "Unlocked — continue".
4. Session expiry (alarm): background re-adds the rule. On YouTube, `session-guard.js` shows an
   in-page overlay at expiry (pauses the video): "Your N minutes are up" → *Leave* (`CLOSE_TAB`)
   / *Take a breath* (navigate to pause page with this URL). On user-added sites, `guard.js`
   (registered dynamically with `scripting.registerContentScripts` once the user grants the
   host permission) does the same with a minimal overlay.

### 8.4 Focus blocks, schedules, daily limit

- **Focus block**: popup buttons 25 min / 1 h / 4 h / until tomorrow. `state.block = {until,
  reason:'focus', siteKeys}` → block rules + alarm. Open YouTube tabs get redirected by
  `session-guard.js` (listens to `state` changes).
- **Early unlock friction** (`focus.unlockFriction`): `none` | `wait` (30 s countdown) |
  `phrase` (type a sentence). `focus.strict` = no early unlock at all.
- **Schedules** (`focus.schedules`): list of `{ id, name, days:[0-6], start:'09:00', end:'17:30',
  action: 'block' | 'preset:<presetId>', siteKeys, enabled }`. Overnight ranges supported.
  Background evaluates at each minute alarm (`chrome.alarms` period 1 min) — cheap — and sets
  `state.scheduleOverride` / block accordingly. Pure function `activeSchedules(list, date)` is
  unit-tested (DST, overnight, multiple overlapping: block beats preset; first preset wins).
- **Daily limit** (`focus.dailyMinutes`, 0 = off): when `stats[today].youtube.activeSec ≥ limit`
  → block until local midnight with reason `limit`. "5 more minutes" button on the blocked page
  (`focus.limitGrace` count per day, default 1) adds to `state.extraTime[today]`.

### 8.5 Commands (keyboard shortcuts)

`toggle-enabled` (Alt+Shift+P), `focus-25` (Alt+Shift+F), `open-picker` (Alt+Shift+H).
Users can rebind in about:addons.

---

## 9. Design system (popup, options, pause, blocked, welcome)

Direction: **"ink on linen"** — a calm stationery sheet. Asymmetric, ruled, quiet. One
persimmon dot is the only loud thing on any screen (the brand "seal"): it is the logo, the
breathing sun on the pause page, and the "on" indicator. No cards-in-cards, no gradients,
no glows, no drop shadows except the popup's own window, no emoji.

Tokens (`src/pages/common/tokens.css`), light is default, dark via `[data-theme="dark"]`
and `general.theme = light | dark | system`:

| token | light | dark |
|---|---|---|
| `--paper` (background) | `#F3EEE3` | `#14162B` |
| `--paper-2` (raised rows, inputs) | `#EAE2D1` | `#1C1F3A` |
| `--ink` (text) | `#1B2050` | `#E9E3D6` |
| `--ink-2` (secondary text) | `#5E5A55` | `#A8A3B8` |
| `--rule` (hairlines) | `#B9C4D3` (dusty blue) | `#33385C` |
| `--clay` (muted accent, focus rings) | `#9A8074` | `#B79E91` |
| `--olive` (positive / "on" text) | `#7C7034` | `#C2B46A` |
| `--seal` (the one loud accent) | `#E5600F` | `#F47A2E` |
| `--danger` | `#B3412F` | `#E07A68` |

Check contrast: body text ≥ 7:1 on paper, secondary ≥ 4.5:1. (Agents must verify with a quick
script and adjust `--ink-2` if needed.)

Typography (no remote fonts): headings `"Iowan Old Style", "Palatino Linotype", Palatino,
"Book Antiqua", Charter, Georgia, serif`; UI `system-ui, -apple-system, "Segoe UI", Roboto,
"Noto Sans", sans-serif`; numbers `ui-monospace, "SF Mono", Menlo, Consolas, monospace` with
`font-variant-numeric: tabular-nums`.
Spacing rhythm on a 7 px unit: 7 / 14 / 21 / 28 / 42 / 56. Radius 3 px (paper, not bubbles).
Rules: 1 px `--rule`. Motion: 200–400 ms ease-out, respect `prefers-reduced-motion`.

Layouts:
- **Options**: a narrow left "table of contents" (sections numbered `01`–`15` in the mono face,
  current one marked with the seal dot), wide right column. Settings are **ledger rows**
  separated by hairlines: label + one-line description left, control right. Group sub-headings
  in small caps. Top bar: search field (filters rows across all sections by label/description/
  tags), preset menu, bulk-action chips. Sticky "Show advanced" switch.
- **Popup** (~360 px wide): wordmark + master switch on one line; quick toggles as ledger rows;
  "Focus" block with duration buttons; today's numbers (time on YouTube, opens, times you turned
  back) in mono; footer links (Hide an element · Settings).
- **Pause**: full viewport, linen ground, a single persimmon circle that grows/shrinks with the
  breath (scale 0.6 ↔ 1.0, 4 s in / 4 s out by default, timed to `breathSeconds`), one serif line
  of guidance ("Breathe in…" / "…and out"), then the question and the two actions. Generous
  whitespace, content left-aligned in a narrow column at ~38% from the left (asymmetric).
- **Blocked**: same ground, the seal dot is *hollow* (outline) to signal "closed"; remaining time
  in large mono; reason line; quiet unlock control (if allowed) at the bottom.

Controls: native `<input type="checkbox">` styled as a small switch (`appearance: none`),
native `<select>`, native number/text inputs with linen fill. Focus states always visible
(2 px `--clay` outline). Everything keyboard accessible; labels bound to inputs.

Icon: `icons/icon.svg` — a persimmon dot sitting on a short indigo horizon line, on transparent.
PNGs generated by `tools/make-icons.mjs` (Playwright screenshot of the SVG).

---

## 10. Phases, owners and acceptance criteria

Execution model: Sonnet sub-agents implement; Opus (orchestrator) reviews every phase
(reads the diff, runs lint/tests/E2E, inspects screenshots), sends fixes back, and commits.
Review notes go to `docs/reviews/phase-N.md`.

| Phase | Parallel? | Agent | Owns (writes) | Acceptance |
|---|---|---|---|---|
| **0 Foundation** | with 1 | Sonnet A | manifest.json, package.json, eslint config, .gitignore, `src/shared/{namespace,browser-api,util,messages}.js`, `src/background/{background,sw-chrome}.js` (stub), `tests/unit/_load.mjs`, `tests/e2e/harness.mjs` + smoke spec, `tests/firefox/*`, `tools/make-icons.mjs`, `icons/*`, README skeleton | `npm run lint`, `npm test`, `npm run e2e` (extension loads in Chromium, background alive, a content script on youtube.com sets an attribute), `npm run test:firefox` (same in real headless Firefox) all green |
| **1 Selector research** | with 0 | Sonnet B | `docs/youtube-dom.md`, `tools/yt-probe.mjs` | Every setting in §6.3 has ≥1 selector with provenance (live-verified vs public source) and notes on legacy/new variants; screenshots of each page type |
| **2a Schema core + settings + engine** | with 2b | Sonnet C | `src/shared/{schema-core,settings,state,presets}.js`, `src/shared/schema/*`, `src/content/engine.js`, `src/sites/youtube/{page,main}.js`, unit tests | Registry validation, CSS compiler, tokens, effective settings, migrations: unit-tested; engine applies tokens on live YouTube in E2E; SPA nav updates page attr |
| **2b YouTube CSS catalog** | with 2a | Sonnet D | `src/sites/youtube/schema/*.js`, `tools/check-selectors.mjs` | All §6.3 settings defined; `validateRegistry()` clean; live coverage report shows each verifiable selector matching on the expected page and **nothing unintended** (spot screenshots) |
| **3a Options + popup** | with 3b, 3c | Sonnet E | `src/pages/common/*`, `src/pages/options/*`, `src/pages/popup/*` | Every schema setting renders and saves; search; bulk actions; presets (apply/save/rename/delete); import/export/reset; theme; keyboard accessible; E2E screenshots |
| **3b YouTube JS features** | with 3a, 3c | Sonnet F | `src/sites/youtube/features/*` (except session-guard, time-tracker), `src/sites/youtube/page-bridge.js` | Each feature verified on live YouTube in E2E (redirects, autoplay off, theater, speed, filters, thumbnails hover, calm titles, channel videos tab, home placeholder) |
| **3c Mindful Pause + Focus + background** | with 3a, 3b | Sonnet G | `src/background/*`, `src/pages/{pause,blocked}/*`, `src/sites/youtube/features/{session-guard,time-tracker}.js`, `src/content/{overlay,guard}.js` | DNR rules compiler unit-tested; pause flow E2E (redirect → breathe → continue → YouTube loads; turn back closes/returns); focus block E2E; schedules pure-function tests; stats recorded |
| **4 Power features** | partly parallel | Sonnet H/I | picker, custom rules/CSS, settings lock, welcome/onboarding, shortcuts | Picker E2E: pick an element → rule saved → element hidden after reload; lock blocks changes in options/popup; onboarding applies chosen preset |
| **5 Hardening & ship** | — | Sonnet J + Opus | e2e/firefox suites, docs, CHANGELOG, PRIVACY, build | Full suites green in Chromium + real Firefox; `web-ext lint` 0 errors; `npm run build` produces zip; README covers Zen install + signing |

---

## 10.1 Risk register — validate early in REAL Firefox (Phase 0 harness, then each phase)

| # | Risk | Mitigation |
|---|---|---|
| R1 | Firefox DNR `regexSubstitution` redirect to a `moz-extension://` page may be refused | Phase 0 smoke test proves it; fallback: `redirect.extensionPath` + background `webNavigation`-free handoff via `storage.session` keyed by tabId |
| R2 | MV3 host permissions not granted at install in some Firefox configs | popup/options show a "Grant access to YouTube" banner when `permissions.contains` is false |
| R3 | `world: "MAIN"` content scripts | require Firefox ≥ 128 (we require 140); bridge is optional — features degrade to DOM methods |
| R4 | `filter: grayscale()` on `<html>` and `position: fixed` (player in fullscreen/miniplayer) | apply to `ytd-app` + `#movie_player` instead if the root filter misbehaves; verify in Firefox |
| R5 | Logged-in-only UI cannot be verified from the cloud (no account) | selectors from public sources are marked "unverified"; ask the user to run the live check (`docs/selector-report.md`) in Zen once |
| R6 | YouTube A/B tests and DOM churn | multiple selectors per setting (legacy + view-model), `npm run selectors` report, picker as escape hatch |

---

## 11. Future: other sites & ideas

Architecture: each site = `src/sites/<site>/{schema/*, page.js, features/*, main.js}` + a
content_scripts entry; engine, settings, pause, focus, stats are already site-agnostic
(`siteKey`).

- **Instagram**: hide Feed (keep DMs), Stories tray, Reels tab & Reels in feed, Explore grid,
  suggested posts/accounts, like counts; "DMs-only mode"; redirect `/` → `/direct/inbox/`.
- **X / Twitter**: hide For You (force Following), trends, Who to follow, metrics, Explore,
  Grok; "Read-only mode" (hide compose box); redirect home → a list.
- **LinkedIn**: hide feed (keep Messaging/Jobs/Notifications), "Add to your feed", promoted
  posts, news module, reactions counts; "Inbox-only mode".
- **Reddit**: hide home/popular feeds, sidebars, trending, comment scores; open old.reddit.
- **Cross-site ideas**: Mindful Pause for any site (already in v1); "intention journal"
  (review what you said you came for vs. time spent); weekly calm report; "grayscale after N
  minutes"; a gentle full-screen "time check" at 20 min; "delay feeds, not search" (feeds
  appear only after 10 s of not searching); sync via Firefox Sync (storage.sync) with
  conflict-free per-key storage.
