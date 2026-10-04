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
- `tools/yt-probe.mjs` (Phase 1) has 2 unused-var lint errors — Phase 1 owner fixes.

## Phase 1 — pending (review will be appended here)
