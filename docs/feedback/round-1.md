# User feedback, round 1 (2026-10-05) — decisions

The user tested 0.1.0 in Zen on macOS. Each item, the decision, and who does it.

| # | Feedback | Decision | Owner |
|---|---|---|---|
| 1 | Shortcuts should be for Mac | Show shortcuts in Mac notation (⌥ ⇧ ⌘ ⌃) on macOS everywhere they appear, from the shortcut actually assigned (`commands.getAll()`), and set explicit `mac` suggested keys. | 7a |
| 2 | Over-explaining; home placeholder should just say "Your home is hidden." | Copy rule for every surface: say what it is; no second sentence unless a choice needs it. Placeholder = glyph + "Your home is hidden." only. Setting descriptions only where the label is ambiguous, ≤ 8 words. | all (7b: setting descriptions; 7a: popup/options/welcome; 7c: pause/blocked/overlay/placeholder) |
| 3 | Create my own presets | Presets become first-class: popup "Save as preset…" and an options **Presets** section (new from current, apply, update from current, rename, delete). The presets dialog goes. | 7a |
| 4 | Popup's Shorts/Recommendations/Comments buttons are useless | Remove them. The top control becomes the popup's navigation: **This page** · **All** · **Focus**. | 7a |
| 5 | Change every setting from the popup (to see YouTube change live) | Popup holds every setting: "This page" = the sections for the YouTube page in the active tab; "All" = every section (collapsible, with search); "Focus" = blocks, pause, today. Complex editors (lists, schedules, sites, lock, backup, picked rules) open the settings page at that row. | 7a |
| 6 | Thumbnail = a frame from the video (e.g. the middle) | New setting "Thumbnail picture": Original · Early · Middle · Late (frames at about ¼, ½ and ¾), using YouTube's own auto-generated frames (`i.ytimg.com/vi/<id>/mq1|mq2|mq3.jpg`). | 7b |
| 7 | "Hide view counts" hides the wrong things (screenshot: "✓386K1d ago") | Bug: it removed the channel name and separators and left the number. Fix so only the view count (and its separator) disappears on every card type, channel name and date stay. | 7b |
| 8 | Hide previous searches | New setting: hide search history rows in the search box dropdown. | 7b |
| 9 | Pause screen: no link bottom-left; bottom-right "Press Esc to close"; drop "What did you come for?" | Done as stated; the intention setting, input and stored intentions are removed. | 7c |
| 10 | Channel pages: hide individual sections (Posts, "Our Members", Join, Community…) | Per-section settings for channel home shelves (by type), header buttons (Join, etc.) and tabs, tagged language-free by the page bridge; "Hide all rows" stays. | 7b |
| 11 | Publishing to Mozilla must let Claude update it without extra work | Release pipeline: version bump script, GitHub Actions that test, sign and submit to AMO on a tag, AMO listing metadata, docs/RELEASING.md. | 7d |
| 12 | Subtract what isn't useful; no other socials | Remove: calm titles, custom CSS (and its sanitizer), pause breath escalation + "show count"/"expiry overlay" toggles (behaviour stays on), the intention prompt, the picker's "Only this one". Other socials dropped from the roadmap. | 7b (calm titles), 7c (rest) |

## Additions after the first answers

| # | Feedback / decision | Owner |
|---|---|---|
| 1 (decided) | Mac shortcuts: ⌥⇧P / ⌥⇧F / ⌥⇧H. | 7a |
| 11 (decided) | Private (unlisted) AMO signing; licence "All rights reserved"; auto-updates from a small public repo `cristianbagrin/at-peace-updates` holding only signed `.xpi` files and `updates.json` (the source repo stays private). | 7d |
| 13 | "Your N minutes are up" overlay: drop the sub-sentence; **Esc dismisses it**; "Breathe again" must not leave or reload the page (breathe in place, then continue); add **"Finish this video"** — the overlay hides and returns when the current video ends (or when you open another video). Esc = "Finish this video" on a watch page, "Breathe again" elsewhere. | 7c |

## Review notes (Opus)

- **7a** (popup-first settings, presets, Mac keys, copy): accepted. Applying a preset asks only when it would replace a hand-made mix. Follow-up 7e removes the options page's "Hide all" chip bar too (the same bulk idea the user called useless in the popup; presets cover it) and the now-unused `quick:` schema flag.
- **7b** (YouTube): accepted. The thumbnail frames are YouTube's `mq1/2/3` stills at about ¼, ½ and ¾ of the video, so the options are labelled Early · Middle · Late (not Start/End). Search history, the Join button and the signed-in one-row card layout could not be seen logged out; they are on VERIFY.md.
- **7c** (calm surfaces, subtraction, item 13): accepted. Esc does nothing during the in-place breath and its choice (it must not skip the breath or close a tab by accident). Of 7c's list of further low-value candidates, none are removed now: user-added pause sites are the "1:1 website blocker" the user asked about; the per-element YouTube toggles are the core "hide everything" promise; the rest (limit grace, strict + friction as one select, preset schedules) are small and can be revisited with real use.
- **7d** (release): accepted. The user put all three credentials in one secret, `MOZILLA_GITHUB`; the workflow finds each by its shape (or in three named secrets) and checks them against Mozilla and GitHub before signing. `release-check.yml` verified the setup without using up a version.
- **Publishing** (user's choice: fully automatic): tags cannot be pushed from Claude sessions, and a workflow token may not tag a commit whose workflow files differ from the default branch. So a pushed "Release x.y.z" commit publishes by itself, the public updates.json is the record of what is published, and a version Mozilla already signed is downloaded instead of signed again (a failed run is finished by re-running it). 0.2.0 was published this way on 2026-10-08.
