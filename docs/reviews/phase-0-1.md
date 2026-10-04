# Review — Phase 0 (Foundation) and Phase 1 (Selector research)

Reviewer: Opus orchestrator. Date: 2026-10-04.

## Phase 0 — approved

Verified by re-running: `npm test` 81/81, eslint clean, `web-ext lint` 0/0/0, `npm run e2e` 9/9
(Chromium), `npm run test:firefox` 11/11 (real Firefox 157 headless).

Risk outcomes (PLAN §10.1):
- **R1 resolved**: DNR `regexSubstitution` redirect to `moz-extension://…/pause.html#<original url>`
  works in Firefox, query string intact. `web_accessible_resources` for the target page is
  REQUIRED in Firefox (without it the navigation dies). Keep pause/blocked in WAR.
- **R2**: host permission `*://*.youtube.com/*` granted on (temporary) install. Keep the
  "grant access" banner (users can revoke in about:addons).
- **R3 resolved**: `world: "MAIN"` content scripts run in the page realm in Firefox.

Conventions established in Phase 0 that every later phase MUST follow:
- Messages: wire format `{ type, payload }`; background handlers are
  `(payload, sender) => response | Promise<response>` registered on `AP.background.handlers`
  (`src/background/background.js`). Every response has `ok: boolean`, failures `error: <code>`.
  `AP.msg.send(type, payload)` resolves `{ok:false, error:'no-receiver'|'context-invalidated'}`
  instead of throwing for those two cases.
- Logging: `AP.log(...)` (silent unless `AP.debug`), `AP.warn(...)` (always, `[At Peace]` prefix).
- ESLint mechanically forbids raw `chrome`/`browser` in `src/` (use `AP.api`), `innerHTML`/
  `outerHTML` assignment, `insertAdjacentHTML`, `document.write`, `eval`.
- `tests/unit/manifest.test.mjs` guards load order: `src/background/sw-chrome.js` importScripts
  list must equal `manifest.background.scripts`; isolated content-script lists start with the
  core shared scripts; MAIN-world scripts must not reference `AtPeace`/`chrome.`/`browser.`;
  extension pages have no inline scripts; every manifest-referenced file exists.
  **When you add a classic file, update manifest + sw-chrome.js + page script tags together.**
- Test commands: unit `tests/unit/*.test.mjs` (`loadAtPeace`, `installFakeBrowser` in
  `tests/unit/_load.mjs`); Chromium E2E `tests/e2e/*.spec.mjs` using `tests/e2e/harness.mjs`
  (`launch()`, `extUrl()`, `openExtPage()`, `setStorage()`, `getStorage()`, `close()`);
  real Firefox `tests/firefox/smoke.mjs` (Selenium; extension pages reachable at the pinned
  test UUID; extension APIs via `executeAsyncScript` on an extension page).
- Firefox is the product target (Zen). Any feature that touches the DOM of YouTube, the DNR
  rules, or extension pages must be exercised in the Firefox harness too, not only Chromium.

Minor notes (no action needed now):
- Chromium leaves `Alt+Shift+P` unassigned (test-only browser; Firefox assigns all three).
- `tools/yt-probe.mjs` lint errors were fixed by its owner (verified clean).

## Phase 1 — approved with decisions

`docs/youtube-dom.md` is high quality: provenance per selector, exact-DOM snapshots, layout-hole
measurements. Decisions (these amend PLAN §6 and override it where they conflict):

### Environment limits (accepted, tracked for the user)
- No video playback in the cloud sandbox (googlevideo blocked; bot gate) and no YouTube login.
  Features that need playback or a logged-in account (autoplay-next effect, end screens, ads,
  "still watching", hover previews, `noAutoStart`, logged-in masthead/guide/home/subscriptions)
  cannot be verified here. They are built from the best evidence available and go on the
  **user verification checklist** (`docs/VERIFY.md`, Phase 5) for a 10-minute check in Zen.

### Catalog changes
- ADD `yt.search.hideAISummary` [ai] — AI-generated summaries inside search results.
- ADD `yt.watch.hideUploadDate`.
- DROP `yt.general.hideLiveBadgesAndPremieres` and `yt.home.limitRows`.
- `yt.watch.hideRelated` must not leave an empty 412 px column: when nothing else in
  `#secondary` is visible (no playlist panel, no expanded live chat, no expanded engagement
  panel), collapse `#secondary` so the player reflows wide (guarded rule from the research).
- `yt.guide.hideAll` / `hideMini` must remove the left gutter too
  (`ytd-app[guide-persistent-and-visible] ytd-page-manager…{margin-left:0}`, `[mini-guide-visible]`).
- `yt.home.hideChips`: `#chips-wrapper` is dead — use the researched selectors.
- `yt.general.hideMixes`: `list=RD` alone is not a Mix signal — use the researched selector only.
- Page types: drop `explore` (redirects to `/`), add `hashtag` (`/hashtag/…`).

### Contract C5 — bridge tags (language-free hooks set from the MAIN world)
Some elements have no language-free CSS hook (only localised titles/aria-labels). The MAIN-world
`page-bridge.js` (Phase 3b) reads YouTube's own data objects and tags elements with attributes
that our CSS can target. Names are fixed here so the CSS catalog (2b) and the bridge (3b) agree:

| attribute | on | values |
|---|---|---|
| `data-at-peace-entry` | `ytd-guide-entry-renderer`, `ytd-mini-guide-entry-renderer` | `home`, `shorts`, `subscriptions`, `you`, `history`, `playlists`, `your-videos`, `watch-later`, `liked`, `downloads`, `courses`, `your-clips` (derived from `data.icon.iconType`; unknown → not tagged) |
| `data-at-peace-tab` | `yt-tab-shape` on channel pages | URL suffix of the tab: `home`, `videos`, `shorts`, `streams`, `podcasts`, `playlists`, `posts`, `store`, `courses`, `releases` (derived by matching the page data's tab titles+URLs to the DOM `tab-title`) |
| `data-at-peace-action` | each top-level button host in `ytd-watch-metadata #actions` | `like`, `share`, `download`, `clip`, `thanks`, `save`, `ask`, `more`, `join` (derived from button data `iconName`/`targetId`; 3b reports which are feasible) |

The CSS catalog uses these attributes as **additional** selectors next to any verified
language-free CSS (e.g. guide hrefs), so hiding works even before/without the bridge where
possible. Settings that depend only on bridge tags carry `feature: 'bridgeTags'`.

### Other findings to carry forward
- `ytd-watch-flexy` and the full player DOM exist (hidden) on every page → all `.ytp-*` and
  watch selectors MUST be page-scoped to `watch` (or shorts where relevant).
- `autoTheater`: set cookie `wide=1` for full loads + click `.ytp-size-button` on SPA navigation.
- `dismissStillWatching`: keep `window._lact` fresh from the bridge + click the confirm button
  of the dialog as fallback.
- Autoplay: click `button.ytp-autonav-toggle` when inner `[aria-checked="true"]`, re-verify, plus
  `setAutonav(false)` via the bridge.
