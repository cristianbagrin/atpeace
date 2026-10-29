# Changelog

All notable changes to At Peace. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the version number follows [Semantic Versioning](https://semver.org/).

Write what changed under "Unreleased" as you go. `npm run release` turns that section into the next
version (see [docs/RELEASING.md](docs/RELEASING.md)).

## Unreleased

## 0.3.2 — 2026-10-29

- Same as 0.3.0, as a new version number for the addons.mozilla.org listing.

## 0.3.1 — 2026-10-29

- Same as 0.3.0, as the version for the public addons.mozilla.org listing (a version number can be used
  only once across the listed and self-distributed channels).

## 0.3.0 — 2026-10-29

- New: "Show results as a grid" (Search results) lays results out in rows of cards, like the home page.
- New: "Keep playing through a playlist" (Video page, with "Do not start videos by themselves"): once
  you press play in a playlist, the next videos start by themselves, so an album plays through.
  Single videos still wait for you.
- Popup and settings: controls answer the moment you press them (buttons sink a little, the switch knob
  stretches), the chosen tab lifts off its track (in dark too), dialogs fade and scale in, and the
  settings bar is frosted so rows scroll under it instead of being cut off. Fixed the unit next to a
  number in the popup ("6 seconds") touching its field, and the pause-sites list now lines up with the
  rows around it. More contrast is honoured on panel edges.

## 0.2.1 — 2026-10-09

- New: "Stop infinite scroll" on the home page (infinite scroll off).
- New: toggles for things people hid by hand: the Subscribe button and the animated button on a video
  page, the buttons under a channel's name, its links and its awards shelf. "Hide Ask (AI)" also hides
  the ask block in the description.
- Removed: Filters (hide videos by word or channel, hide comments by word). Your saved words are ignored
  and every other setting stays as it was.

## 0.2.0 — 2026-10-08

### Updates

- Installed copies update themselves: Firefox and Zen check for a new signed version once a day.

### Popup

- Every setting is in the popup, so YouTube changes in front of you: **This page** (the sections for
  the YouTube page you are on), **All** (every section, with a search) and **Focus** (blocks, the pause,
  limits and today). Lists, schedules and other editors open the settings page at that row.
- The Shorts / Recommendations / Comments buttons are gone, and so is the settings page's "Hide all" bar of
  the same kind. Presets change many settings at once.
- Your own presets: save the current settings as a preset from the popup, and apply, update, rename or
  delete them in the new **Presets** section of the settings.
- Mac shortcuts ⌥⇧P (on / off), ⌥⇧F (block for 25 minutes) and ⌥⇧H (hide an element), shown in Mac
  notation.
- Shorter text everywhere.

### YouTube

- Fixed: "Hide view counts" hid the channel name and kept the number on some cards (signed-in home).
  Now only the view count goes; channel, badge and date stay. Same fix for the subscriber count on
  channel pages.
- New: hide previous searches in the search box.
- New: hide single rows on a channel's Home (Shorts, posts, members-only, live, popular, playlists,
  featured channels), the Join button, and the Shows, Courses, Members and Releases tabs.
- New: thumbnail picture: Original, or a frame from early in, the middle of, or late in the video.
- Removed: calm titles.
- Setting descriptions only where the name alone is unclear.

### Time's up

- "Your N minutes are up." has no second sentence. On a video page it offers **Leave YouTube**,
  **Finish this video** and **Breathe again**; elsewhere **Leave** and **Breathe again**.
- **Esc** closes it: on a video page it means Finish this video, elsewhere Breathe again.
- **Finish this video** hides it and keeps the video playing; it comes back when the video ends or when
  you open another video or page.
- **Breathe again** breathes right there, then asks how long to continue. No reload, and the video goes
  on where it was.

### Pause page

- No address in the corner; "Press Esc to close" instead. "What did you come for?" is gone.
- Shorter text on the pause and blocked pages, the hidden-home card ("Your home is hidden.") and the
  element picker.

### Removed

- Custom CSS (the element picker covers hiding things), the pause's growing breath and its settings,
  the "show count" and "time's up" switches (both always on), the picker's "Only this one", and stored
  intentions. Settings for these are cleaned up on update.

## 0.1.0 - first release

The first version: YouTube only, desktop (`www.youtube.com`), Firefox and Zen 140 or newer.

### Declutter

- About 140 settings that hide parts of YouTube: all of YouTube (ads, Premium promos, hover previews,
  view counts, dates, durations, badges, grayscale, thumbnails shown / blurred / grayscale / hidden),
  the top bar, the left sidebar, Home, the video page, the player, comments, search results, Shorts,
  Subscriptions and channel pages. Every rule is switched by one attribute on the page, so changes are
  instant and nothing flickers while YouTube navigates.
- Filters: hide videos by words (plain text or `/regex/`) or channel, and hide comments by word.
- An element picker ("Hide an element"): click something on the page, choose how much of it, and the
  rule is saved. Rules are listed and editable in Settings.
- Custom CSS, with remote imports and links removed.

### Redirect

- Home page: show the feed, show a calm empty page, or go to Subscriptions, Watch later, your
  playlists or a page of your own.
- Shorts: allow, open in the normal player, or show a calm "Shorts are off" page.
- Channels open on their Videos tab.

### Behave

- Turn autoplay off, do not start videos by themselves, open videos in theater mode, set a default
  playback speed, skip "Are you still watching?", calm SHOUTING titles.

### Mindful Pause

- A breathing screen before YouTube (or any site you add) opens, with the number of times you opened
  it today, an optional "what did you come for?" line, then **Close** or **Continue for N minutes**.
  When the minutes run out, a gentle note appears and the video pauses.
- The length of the breath can grow when you come back often.

### Focus

- One-click focus blocks (25 minutes, 1 hour, 4 hours, rest of the day), weekly schedules that block
  or apply a preset, and a daily time limit with a limited number of "5 more minutes".
- Ending a block early can need a 30 second wait or a typed sentence, or be impossible.
- Local usage numbers: time on YouTube, openings, times you turned back.

### Own it

- Four built-in presets (Gentle, Focused, Deep work, Untouched) and your own; export, import and reset.
- A settings lock: a password or a moment of friction before anything can be shown again. Making
  YouTube quieter always works.
- A welcome page for the first run, keyboard shortcuts (Alt+Shift+P on/off, Alt+Shift+F focus 25
  minutes, Alt+Shift+H hide an element), a light, dark or system theme.

### Privacy

- Nothing leaves the browser: no analytics, no accounts, no remote code or fonts, no network requests
  of its own. See [PRIVACY.md](PRIVACY.md).

### Known limits

- Parts of the signed-in YouTube interface and everything that needs video playback could not be
  checked while building. [docs/VERIFY.md](docs/VERIFY.md) is a short checklist for checking them.
- Google's bot check can interrupt the live-YouTube tests; those tests skip instead of failing.
