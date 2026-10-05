# Ideas

Things that are not in 0.1.0 but are worth considering. None of this is promised. The order inside each
group is roughly "most useful first".

## More sites

The engine, settings, Mindful Pause, focus blocks and stats do not know about YouTube. A site is a folder
`src/sites/<site>/` (schema, page detection, features, `main.js`) plus a `content_scripts` entry. The
`siteKey` already separates stats and sessions per site. Mindful Pause already works on any site you add
by hand; what is missing is hiding things *inside* those sites.

- **Instagram**: hide the feed but keep messages, the Stories tray, Reels (the tab and in the feed),
  Explore, suggested posts and accounts, like counts. A "messages only" mode that sends `/` to
  `/direct/inbox/`.
- **X (Twitter)**: show only Following instead of For You, hide trends, Who to follow, metrics, Explore
  and Grok. A "read only" mode that hides the compose box. Send the home page to one of your lists.
- **LinkedIn**: hide the feed but keep Messaging, Jobs and Notifications. Hide "Add to your feed",
  promoted posts, the news module and reaction counts. An "inbox only" mode.
- **Reddit**: hide the home and popular feeds, sidebars, trending and comment scores; open old.reddit.com.
- **YouTube, other flavours**: `m.youtube.com`, `music.youtube.com` and YouTube Kids are out of scope today
  because their DOM is different. Embedded players on other sites are untouched.

## Across sites

- **Intention journal**: look back at what you said you came for and how long you actually stayed. The
  pause screen already keeps the last 20 lines per site; there is no screen that shows them yet.
- **Weekly calm report**: one quiet page with the week in numbers, shown on Sunday evening.
- **Grayscale after N minutes**: let the page lose its colour the longer you stay.
- **A time check at 20 minutes**: a gentle full-screen "still want this?" that is not a block.
- **Delay feeds, not search**: the feed appears only after ten seconds without searching.
- **Sync** through Firefox Sync (`storage.sync`) with one key per setting, so two devices merge instead of
  overwriting each other. Needs a decision about whether stats stay local (they should).
- **Translations**: user-visible text lives in the files that use it, so it can move to `_locales/`
  without touching logic. Selectors never depend on text, so the hiding already works in any language.

## Making it easier to keep working

YouTube changes its page often. These would make breakage cheaper to find and fix.

- **An in-browser selector check.** `npm run selectors -- --live` needs Node and Playwright, which most
  people do not have next to their daily browser. A "Check this page" button (options or the picker)
  could count matches for every setting that applies to the current page and copy a short report with the
  setting ids that matched nothing.
- **Show the setting id** on hover or behind "Show advanced", so a bug report can name it.
- **A scheduled live run** of the selector report with a signed-in profile, so drift shows up before a
  user notices.
- **Commit a small set of page snapshots** as test fixtures (about 5 MB today). Right now they are local
  files made by `tools/yt-probe.mjs`, so on a fresh clone the tests that need them skip.
- **Picker: `:has()` selectors** so choosing a generic wrapper can be narrowed to "the one that contains
  this link" instead of falling back to a position.
- **Hover previews and end screens** are only verified by hand (see `docs/VERIFY.md`). A recorded
  playback fixture (a local video behind a YouTube-shaped page) would let the tests exercise autoplay,
  speed and "still watching" without Google.

## What the build taught us

- The page's own state is often the only language-free handle (a guide entry's icon type, a channel tab's
  URL). The MAIN-world bridge reads it and tags elements; anything that depends on it is listed with
  `feature: 'bridgeTags'` in the schema. A few of those tags are mapped from knowledge of the data and
  never seen live (see `docs/VERIFY.md`).
- YouTube starts a navigation 0.1 to 1 second before the new page exists. Page-scoped rules therefore
  match both the page on screen and the page being opened; that is what keeps navigation flicker free.
- A control bar keeps its old width after a layout change, so the engine nudges the player with a
  `resize` event after anything that changes the watch layout.
- Google answers rapid page loads with a captcha that sticks to an IP. Tests that need YouTube's DOM
  should use the offline snapshots; live tests are paced and skip when the captcha shows up.
- Chrome's DNR rejects counted repetitions in regular expressions (`{11}`); a unit test forbids them.
