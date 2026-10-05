# Review — Phase 5 (hardening, Firefox validation, docs, packaging) — approved

Reviewer: Opus orchestrator. Date: 2026-10-05.

Verified by Opus on the final tree: `npm run lint` clean (eslint + web-ext 0/0/0), `npm test`
855/855, `npm run verify:package` OK (95 files, ~293 KiB; only manifest, icons, src). Agent-reported:
Chromium E2E 220 pass / 0 fail / 4 skipped (Google captcha) after the harness fix; real Firefox
76 pass / 0 fail / 4 skipped (captcha, page served without the watch buttons).

Worth keeping:
- Test honesty: 27 vacuous `waitForFunction(async …)` waits replaced by one awaited polling helper
  (`tests/helpers/wait.mjs`); every remaining skip states an environment reason.
- Harness waits for install-time setup (Gentle preset, meta, welcome tab) before tests reset
  storage — fixed the focus-spec race at the root.
- Live specs detect Google's 429 / `/sorry/` and skip instead of failing.
- Permanent real-Firefox catalog check on offline snapshots (17 tests incl. grayscale with fixed
  top bar, blur-on-hover, layout nudge, playlist panel kept, mini-guide bridge tags).
- Performance: tokens applied 19–68 ms after document_start on home/search, our CPU 8–13 ms;
  mutation bus ~1.4 % of a core with every feature on; no leaked listeners/observers across 20 SPA
  navigations (docs/PERFORMANCE.md).
- axe-core: 0 violations on popup, options, welcome, pause, blocked.

Opus fixes after the report: the lock editor's first radio had two labels (row label + its own) →
the radio group is now named by the row label; popup footer buttons get a 24 px minimum target.

Open / user decisions:
- License: none declared (user's call).
- Research DOM snapshots stay local (git-ignored, ~5.5 MB); on a fresh clone the offline suites skip.
- Everything that needs playback or a signed-in YouTube account is on docs/VERIFY.md.
