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
