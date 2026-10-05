# Performance

What At Peace costs on a YouTube page, measured, not guessed. The numbers come from
`tests/e2e/perf.spec.mjs` (run with `npm run e2e`), which also fails if they get an order of magnitude
worse or if anything leaks. It writes the raw results to `tests/e2e/artifacts/perf.json`.

How it is measured: headless Chromium in a shared cloud sandbox, the extension loaded, YouTube replaced by
the offline page snapshots (no traffic to Google, so every run is the same page). The snapshots are real
YouTube DOM but not YouTube's own scripts and CSS, so absolute times on the real site will differ; the
point is how much work *our* code does. "Our CPU" is V8's sampling profiler (100 µs) restricted to files
inside the extension. The Deep work preset (the biggest one) is on unless stated.

## Startup: document_start to tokens applied

| page | `<style>` in the document | tokens on `<html>` (wall clock) | our CPU until then |
|---|---|---|---|
| home | +13 to 20 ms | +23 to 33 ms | 10 to 13 ms |
| search results | +12 to 16 ms | +50 to 68 ms | 12 ms |
| video page | +19 to 40 ms | +97 to 165 ms | 11 to 13 ms |

Median of 7 loads (wall clock) and of 5 loads (CPU), several runs. The wall-clock time is
the time to the first free moment of the page's thread after our storage read; on the snapshot pages it is
inflated by the page's own work (the video-page snapshot is a 1.7 MB inline script to parse), which is why
our CPU is listed too: **about 10 to 13 ms of our code runs before the page is styled**, whatever the
page. The stylesheet is injected before the page's first paint, so nothing flickers.

- Compiling the stylesheet from the schema (`AP.schema.compileCss('youtube')`: 395 rules, 69 KiB):
  **5 to 10 ms** on the first call in a fresh context, under 1 ms when repeated. It is done once per page
  load, not per navigation or per settings change (a settings change is one attribute write).
- The compile (`scan`, `emitCss`, `isSafeSelector` in `schema-core.js`) is the top of the startup profile.
  Nothing else is above 1 ms.

## The mutation bus: a long search page that keeps growing

A search page that gains 40 cards a second for 6.5 seconds (240 cards, scrolling all the while):

| settings | our CPU | per second |
|---|---|---|
| nothing needs the mutation observer (all features off) | 0 ms | 0 ms/s |
| every observing feature on: calm titles, filters, hover guard, Shorts links, autoplay, theater, speed, still-watching, channel tab, home placeholder, bridge tags | 80 to 95 ms | **about 13 ms/s (1.3 % of one core)** |

With every feature on, the top of the profile is the page bridge tagging guide entries and channel tabs
(`tagEntries`, about 40 ms in 6.5 s, roughly 6 ms/s), then the filters (`cardInfo`, `normalize`, about 9 ms)
and calm titles (about 3 ms). One `MutationObserver` serves all features, batched once per animation
frame, and it exists only while an enabled feature asks for it. Nothing here is a reason to change the
design; `tagEntries` re-scans `getElementsByTagName` per batch and could be narrowed if it ever shows up
on a slow machine.

## Leaks: 20 SPA navigations, and every feature off and on ten times

`tests/helpers/instrument.js` (test only) counts what the extension's isolated world holds: event listeners
on things that outlive a page swap (window, document, connected nodes), observers that observe something,
and intervals.

| state | listeners | observers | intervals |
|---|---|---|---|
| after 5, 10, 15 and 20 navigations through search, video, channel, home and history (every feature on) | 36, 36, 36, 36 | 2 | 2 |
| every feature off, before and after 10 on/off rounds | 12 / 12 | 1 (the engine's guard that keeps its `<style>` in the page) | 1 |
| every feature on, before and after 10 on/off rounds | 36 / 36 | 2 | 2 |

The counts are identical every time: no listener, observer or interval is left behind by navigating or by
switching features off. (Right after the page loads there is one listener more, 37, which is gone after the first navigations; from then on nothing changes.)

## What was not measured

- The real site. Google's captcha (`/sorry/`) answers repeated automated loads, so live-page timing is not
  part of the suite. The numbers above scale with the amount of DOM the page adds, which the snapshots
  represent but real YouTube (longer lists, A/B variants, ads) exceeds.
- Memory in bytes. The leak checks count objects we are responsible for; heap size on a real YouTube tab is
  dominated by YouTube itself.
- Slow hardware. The budgets in the spec are deliberately wide (startup under 500 ms of wall clock, under
  250 ms for a cold compile, under 250 ms/s of our CPU with everything on) so a slow machine does not make
  the suite flaky.
