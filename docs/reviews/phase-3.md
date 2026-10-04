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
