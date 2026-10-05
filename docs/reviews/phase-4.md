# Review — Phase 4 (4a picker, 4b lock/onboarding/follow-ups)

Reviewer: Opus orchestrator. Date: 2026-10-05.

## 4a — Element picker + custom hide rules — approved

Verified: picker unit tests 32/32, eslint clean on all 4a files; agent reported `picker.spec`
21/21 (Chromium) and `tests/firefox/picker.mjs` 5/5 (real Firefox), all on offline YouTube
fixtures because Google captcha-gates this IP. Screens reviewed: the review state (target
outlined, 25 similar cards dashed, panel with "26 similar items", Bigger/Smaller, "Only this
one", scope radios, Hide/Cancel) and the options rules editor. Calm and clear.

Worth keeping:
- Selector generation is pure (`AP.picker.selector`), hook-ranked, adds hooks only while they
  narrow the match, anchors with ≤ 2 ancestors, refuses page-level/oversized targets with a
  sentence. Bigger/Smaller walks meaningful components only.
- `tests/e2e/_yt-fixture.mjs` rebuilds www.youtube.com pages from the research snapshots
  (Chromium via `context.route`, Firefox via a local server + HSTS-preload pref) with zero
  remote requests — the standard way to test YouTube DOM features from now on.

Accepted deviations: the 60% rule is measured per side (so `#related` stays pickable);
`refuseSelectorText`/page list duplicated in the options renderer with a unit test proving
parity.

Known gaps (tracked): no live-YouTube verification of picker sizing; no `:has()` generation
(picking a generic wrapper hides all of its kind; "Only this one" is positional).
Bug spotted in a screenshot: stray "false" text after "Your week" on the options page →
sent to 4b (owner of that page right now).

## 4b — Settings lock, onboarding, follow-ups — approved

Agent-reported: `npm test` 820/820, lint clean (eslint + web-ext 0/0/0), `lock.spec` 14/14 and
`welcome.spec` 6/6 (Chromium), `tests/firefox/lock.mjs` 4/4 (real Firefox, incl. a real 10 s
friction wait and fresh-install welcome). Screens reviewed: welcome (three numbered steps,
ledger rows, calm copy), locked popup refusal ("Locked. That would show something again.
Unlock…"), friction unlock dialog. All faithful to §9.

Lock semantics: tightening always allowed; loosening needs a 10-minute unlock; a single pure
`AP.lock.isLoosening(def, old, new)` with a per-setting matrix test; `guardPatch` on every
page plus background enforcement of FOCUS_END, STATS_CLEAR and the on/off shortcut; a unit test
fails if any page writes settings without the guard. Password = PBKDF2-SHA256 250k + salt,
never stored. Friction is trusted from the page (acceptable: "protect from your 11 pm self").

Follow-ups closed: popup short labels (#1), `requires: 'id=value'` (#2), STATS_CLEAR (#3),
lock + custom-rules renderers (#4), stray "false" (fixed at the root: `replaceChildren` with a
boolean; regression test walks all text nodes).

New items for Phase 5:
- Audit every `waitForFunction(async …)` in tests: Playwright doesn't await a promise-returning
  predicate, so those waits may pass vacuously. Replace with a polling `until()` helper.
- PLAN §5/§8.1 should list `state.lockUnlockedUntil`, `LOCK_UNLOCK`, `LOCK_RELOCK`,
  `STATS_CLEAR`, `ONBOARDING_DONE` (Opus updates PLAN).
- Zen pin instructions: verify wording in Zen (user checklist).

# Review — Phase 6 (Dial re-skin) — approved

The user rejected the first visual direction as generic. Opus re-seeded the design (design-seed
skill), studied Untrap's store screenshots, and drew the "Dial" direction on a Claude Design
board; Sonnet K ported it to every surface.

Verified: screenshots reviewed (pause choice, blocked focus, options Video page, popup, welcome,
home placeholder on dark YouTube, icon sizes on light/dark toolbars) — faithful to the board.
Agent-reported: `npm test` 855/855, lint clean, Chromium UI E2E 141/141, Firefox UI/mindful/
picker/lock/features 39 pass / 3 skipped (live YouTube captcha). Contrast for every token pair is
asserted; switch track/field borders were darkened to reach 3:1 (`--field-line`), dark-mode
primary buttons use dark text (`--on-act`).

Opus follow-up: the popup measured ~660 px with every section shown (Firefox caps popups at
600 px) → compacted rows (28 px), focus and stat tiles; measured 591 px; popup spec 21/21.

Kept on purpose: strings asserted by tests (blocked titles, "Breathe in…", "Continue for"), native
selects where a segmented control doesn't fit (default speed, theme), the pause minutes as a
segmented mirror of the real `<select>`.

Open: two intermittent E2E flakes handed to Phase 5 (popup footer timing; focus spec racing the
install-time Gentle preset).
