# Review — Phase 2 (2a schema/engine, 2b YouTube catalog)

Reviewer: Opus orchestrator. Date: 2026-10-04.

## 2a — approved (with one fix by Opus)

Verified: `npm test` 362/362 (incl. the Opus fix below), eslint clean; agent reported e2e 19/19
(Chromium) and Firefox 21/21 with a flicker sampler showing 0 painted frames for page-scoped
rules during SPA navigation in both browsers.

Conventions every later phase MUST follow:
- **Page gating uses two attributes.** `data-at-peace-page` = committed page;
  `data-at-peace-next` = target page while an SPA navigation is in flight. Page-scoped rules
  match either (`AP.schema.gate(token, page)`). Never write these attributes yourself — read
  `ctx.page` in features.
- **Feature interface** (engine.js header): `{ id, settings, observes?, ignoresMaster?, isActive?,
  init?, onSettings?, onNavigate?, onMutations?, destroy? }`. `ignoresMaster: true` (added by Opus)
  keeps a feature running when `general.enabled` is off — REQUIRED for the Pause session guard
  and time tracker, because the master switch only governs how YouTube looks/behaves and must
  never be a way to escape a focus block.
- **Settings API**: `AP.settings.effective()`, `save(patch) → {changed, unknown, invalid}`,
  `reset(ids?)`, `applyPreset(idOrValues)`, `subscribe(cb, initial?) → unsubscribe` with
  `cb(effective, changedIds, {keys})`, custom presets `listCustomPresets / saveCustomPreset /
  renameCustomPreset / deleteCustomPreset`, `exportAll()`, `importAll(json) → report`.
  `readStorage()` retries transient Firefox storage errors — use it rather than raw `storage.get`.
- **Def flags**: `preset: false` (not touched by presets: theme, pause details, schedules, lock,
  custom rules), `portable: false` (excluded from export/import/reset: the lock). `item(raw)` /
  `normalize(value)` hooks; a `list` with `options` is a multi-select.
- **Presets** are recipes (`parent ⊕ bulkTargets(tags) ⊕ explicit set`) resolved at runtime;
  ids: `gentle` (install default), `focused`, `deep-work`, `untouched`. `AP.presets.diagnose()`
  lists unresolved ids — must be empty once the catalog lands.
- **Page types**: home, watch, search, shorts, subscriptions, channel, playlist, history, you,
  hashtag, other (`/feed/trending`, `/feed/explore`, `/gaming` → other).
- `validateRegistry()` is strict (unknown def keys, unknown tags, unknown page types, top-level
  commas in `hide`, site/section mismatch, CSS-less site settings without `feature`).
- Pause defaults: `pause.enabled` false (onboarding asks), `pause.sessionMinutes` values are the
  strings `'5'`…`'60'`.

## 2b — YouTube catalog — approved

140 YouTube settings (general 15, masthead 10, guide 19, home 8, watch 35, player 13, comments 7,
search 8, shorts 5, subs 5, channel 11, filters 4), 396 one-selector rules (~71 KB CSS).
`validateRegistry()` clean, `AP.presets.diagnose()` clean (Gentle 23 / Focused 32 / Deep work 46
YouTube settings). Selector report: 0 invalid, 0 over-broad; zero-match selectors are
deliberate (bridge tags, signed-in-only UI, ads not served logged out, playback-only player
states, legacy A/B variants) and listed in `docs/selector-report.md`. Firefox 157 checks: `:has()`,
`:nth-child(1 of S)`, blur-until-hover, grayscale on `<html>` keeps `position:fixed` (R4 resolved).

Screens reviewed: search before/after (chips, shelves, metadata gone; Filters stays), watch with
related hidden (player widens to 1394 px). **Bug found:** the player's control bar keeps its old
width after a CSS layout change → assigned to 3b (dispatch `resize` after layout-affecting
changes).

Judgement calls accepted: in-stream ad layers are never hidden (would hide Skip); the autoplay
"Up next" countdown is not hidden (it's the warning); Premium modal dialogs not hidden (backdrop
would block the page); positional/guessy selectors dropped. Every `data-at-peace-action` rule
excludes containers, so the bridge must tag button hosts only.

Opus removed the Phase 2a TEMP settings and pointed the engine scenario at
`yt.masthead.hideVoiceSearch`.

Open for the user's verification checklist (Phase 5): signed-in UI (masthead Create/notifications,
guide personal entries + channel list, home feed shelves, subscriptions feed), ads, player
playback states, Mixes.
