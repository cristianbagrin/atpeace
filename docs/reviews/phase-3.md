# Review — Phase 3 (3a UI, 3b YouTube features, 3c Mindful Pause & Focus)

Reviewer: Opus orchestrator. Date: 2026-10-04.

## 3a — Options page, popup, shared page UI — approved

Verified: `npm test` 613/613, eslint clean; screenshots reviewed (options light/dark, long section,
popup idle/focus, real-Firefox renders). The ink-on-linen system is applied faithfully: hairline
ledger rows, numbered TOC with the seal on the current section, one loud accent (popup master
switch), calm copy. Contrast is tested in `tests/unit/contrast.test.mjs`; three light tokens were
darkened to pass (clay, olive, danger) and a new `--edge` token carries control borders.

Accepted deviations: presets live in a dialog (no separate section); ordinary switches turn ink
(not persimmon) when on; options shows *stored* values with a banner when a schedule override is
active; reset returns to schema defaults.

APIs for later phases:
- `AP.ui` (components.js): `h`, `applyTheme`, `watchTheme`, `toast`, `confirm`, `prompt`,
  `openDialog`, `settingControl`, `controlKind`, `hostAccessBanner`; `theme-boot.js` sets the theme
  before first paint (include it first in every page's `<head>`).
- Custom renderers: `AP.optionsRenderers[id] = { render(def, value, ctx), update? }`,
  `AP.optionsRendererFor(def)`; ctx has `save` (rejects with a readable Error), `api`, `h`, `ui`,
  `toast`, `def`, ids for a11y. Documented in `src/pages/options/renderers/registry.js`.

Follow-ups (assigned to Phase 4/5):
1. Popup select labels truncate ("Show the home f…") — give selects in the popup short option
   labels (e.g. a `shortLabel` on options) or widen the control column.
2. `requires` on a select is satisfied by any non-default value → the home redirect URL row is
   enabled for "hide" too. Support `requires: 'id=value'` (schema-core validation + options UI).
3. Usage stats cannot be cleared — add a `STATS_CLEAR` message (background) + a button in
   "Your week".
4. `advanced.lock` and `advanced.customRules` still use the raw JSON editor (Phase 4 renderers).
5. Remove the `// TEMP (Phase 2a test)` settings once the catalog lands (Opus).

## 3c — Mindful Pause, Focus, schedules, limit, stats, background — approved

Verified by Opus: `npm test` 639/639; `pause.spec` + `focus.spec` 46/46 (Chromium, YouTube stubbed
with `context.route` so no Google traffic); `tests/firefox/mindful.mjs` 9 pass / 3 skipped (the
3 need live YouTube, which currently serves a `/sorry/` captcha to this IP). Screens reviewed:
breathing page, choice state ("Close YouTube" primary, "Continue for [15 minutes]" split control),
blocked page with wait friction (hollow seal, big mono countdown), session-expiry overlay on live
YouTube. Calm, faithful to §9.

Design points worth keeping:
- One idempotent, serialized `reconcile()` derives sessions/blocks/override/DNR/alarms from
  storage; GET_STATUS reconciles too, so state self-heals after the event page sleeps.
- Pause page never traps the user (falls back to lifting its own rules) and refuses hostile
  hashes (only configured pause sites are valid targets).
- Focus blocks can only be extended by a second start (a short block can't cut a strict one).
- Pause/blocks ignore the master switch; YouTube redirects respect it.

APIs/contracts added: `state.blocks[]` (all blocks in force; `state.block` = primary),
`state.sessionMinutes`, messages `LIMIT_GRACE`, `BLOCKED_OPENED`; GET_STATUS adds `blocks`, `now`.

Follow-ups:
6. 3b must add `src/sites/youtube/redirects.js` to `background.scripts` + `sw-chrome.js` (allowed
   by the manifest test already) — verify in the 3b review that home/shorts/channel DNR redirects
   are live end to end.
7. Pause-sites/schedules renderers inject their own `<style>`; fold into `options.css` (polish).
8. Testing strategy while Google captcha-gates the IP: stub `www.youtube.com` with
   `context.route` serving pages rebuilt from the research DOM snapshots
   (`tests/e2e/artifacts/research/*.dom.json`, `tools/yt-probe.mjs` helpers) so content scripts
   still inject (URL matches) without Google traffic.

## 3b — YouTube behaviours, bridge, redirects — approved

Verified by Opus: `npm test` 821/821, `npm run lint` clean (eslint + web-ext 0/0/0). Agent
reported `features.spec` 39/39 (Chromium) and `tests/firefox/features.mjs` 12/12 (real Firefox).
The player layout bug found in the 2b review is reproduced and fixed (control bar 972 px in a
1394 px player without the nudge; full width 100 ms after it).

Worth keeping:
- Redirects never `location.replace` at `yt-navigate-start` (would clobber the history entry);
  they run after the Navigation API `navigate` event with `yt-navigate-finish` as fallback, so
  Back works. A loop guard stops repeated redirects (3 in 15 s).
- Firefox cross-world messaging: `event.source === window` is false in Firefox's isolated world
  for page messages; the client checks origin + nonce instead (every bridge call failed before).
- Chrome DNR rejects counted repetitions (`{11}`) with memoryLimitExceeded; a unit test forbids
  them.
- Filters re-sweep after bursts because YouTube rewrites card titles in place.

Bridge tags verified live: entries home/shorts/subscriptions/you/history; tabs home/videos/
shorts/playlists/posts; actions like/share/download/save/more/join. Mapped but unverified
(login or rare UI): personal guide entries, streams/podcasts/store/courses/releases tabs,
clip/thanks/ask buttons → user checklist.

Opus fix: the engine scenario toggling `yt.masthead.hideVoiceSearch` failed because a fresh
install applies Gentle (which hides it); the scenario now starts from the untouched baseline
(verified live).

For the user checklist (no playback/login here): autoplay-next actually stopping, end-screen
countdown cancel, noAutoStart on a real autostart, speed on a playing video, still-watching,
hover previews, signed-in guide entries, Clip/Thanks/Ask, Watch Later redirect when signed in.
