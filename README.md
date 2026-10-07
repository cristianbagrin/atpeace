# At Peace

A calm, intentional YouTube. At Peace is a Firefox / Zen Browser extension that lets you hide the parts
of YouTube you don't want to see and puts a little friction (a breath, a timer, a schedule) between you
and the feed.

Everything runs on your computer. Nothing is sent anywhere: no analytics, no accounts, no remote code.
See [PRIVACY.md](PRIVACY.md).

At Peace works on desktop `www.youtube.com`, in Firefox and Zen 140 or newer.

## What it does

**Declutter.** About 140 switches, each hiding one thing: the home feed, Shorts, comments, related
videos, the sidebar, buttons under a video, view counts, upload dates, duration badges, ads and Premium
promos, AI summaries, end screens, hover previews, and more. Thumbnails can be shown, blurred until you
hover, grayscale until you hover, or hidden. The whole site can go grayscale. Filters hide videos by
word or channel (plain text or `/regex/`) and comments by word. An element picker lets you click
anything the settings missed and keeps it hidden.

**Redirect.** Home can show a calm empty page or send you to Subscriptions, Watch later, your
playlists or a page of your own. Shorts can open in the normal player or be blocked. Channels can open on
their Videos tab.

**Behave.** Turn autoplay off, stop videos from starting by themselves, open videos in theater mode,
start every video at a speed you chose, skip "Are you still watching?", and calm TITLES THAT SHOUT.

**Mindful Pause.** Before YouTube (or any site you add) opens, a breathing screen shows how many times
you opened it today and optionally asks what you came for. Then you choose **Close** or **Continue for N
minutes**. When the minutes run out a gentle note appears and the video pauses.

**Focus.** One click blocks YouTube for 25 minutes, an hour, four hours or the rest of the day. Weekly
schedules block it or switch to a preset at set times. A daily limit blocks it once you reach your
minutes. Ending a block early can require waiting 30 seconds, typing a sentence, or not be possible. The
popup shows the day's numbers.

**Own it.** Four built-in presets (Gentle, Focused, Deep work, Untouched) and your own. Export, import
and reset. A settings lock that asks for a password or a moment of waiting before anything can be shown
again, while making YouTube quieter always works. A welcome page on first run, keyboard shortcuts
(`Alt+Shift+P` on/off, `Alt+Shift+F` focus 25 minutes, `Alt+Shift+H` hide an element), and a light, dark
or system theme.

## Install in Zen (or Firefox)

### Try it (temporary)

1. Get the code (`git clone` or download it).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and choose the `manifest.json` in the project folder.
4. Open https://www.youtube.com/. A welcome tab opens on first run.

A temporary add-on is removed when the browser restarts; load it again from the same page. The code is
read straight from the folder, so after editing a file use **Reload** on that page.

### Keep it (permanent)

Zen, like Firefox release, only keeps *signed* add-ons. Signing is free through the unlisted channel on
addons.mozilla.org and needs your own Mozilla account:

1. Create an account at https://addons.mozilla.org/ and sign in.
2. Get an API key and secret at https://addons.mozilla.org/developers/addon/api/key/.
3. In the project folder:

   ```sh
   npm install
   export WEB_EXT_API_KEY=...        # "JWT issuer"
   export WEB_EXT_API_SECRET=...     # "JWT secret"
   npm run sign
   ```

4. Signing takes a minute or two and writes a `.xpi` into `web-ext-artifacts/`. Drag that file onto a Zen
   window and accept the install prompt.

Never commit the key or secret. The add-on id (`at-peace@cristianbagrin`) must not change: Mozilla ties
the signature to it, and settings are stored per id.

After installing, follow [docs/VERIFY.md](docs/VERIFY.md): a 10 to 15 minute checklist for the parts that
could only be verified in a signed-in browser.

## Using it

- The toolbar button opens the popup: master switch, quick toggles, bulk chips (Shorts,
  Recommendations, Comments, ...), presets, a focus block, today's numbers and **Hide an element**.
- **Settings** has every switch, grouped like YouTube's own layout, with search. Turn on **Show advanced**
  for the rest. **Mindful Pause**, **Focus & limits**, **Advanced** (your hidden elements,
  debug logs, the lock) and **Backup & reset** are sections too.
- Settings apply to open YouTube tabs at once; no reload.

## Development

Requirements: Node.js 22 or newer. There is no build step and no bundler: what is in `src/` is exactly
what ships. Everything under `src/` is plain JavaScript; shared code is classic scripts hanging off one
global, `AtPeace` (see [docs/PLAN.md](docs/PLAN.md), section 3, for the conventions).

```sh
npm install
npm run lint           # eslint + web-ext lint
npm test               # unit tests (node:test, no browser)
npm run e2e            # Chromium end-to-end tests (Playwright, preinstalled in this environment)
npm run test:firefox   # the same ideas in real headless Firefox (Selenium + geckodriver)
```

| script | does |
|---|---|
| `npm run lint` | `eslint .` and `web-ext lint --self-hosted` (0 errors, 0 warnings expected) |
| `npm test` | unit tests in `tests/unit/` |
| `npm run e2e` | Chromium end-to-end tests in `tests/e2e/`; screenshots land in `tests/e2e/artifacts/` (git-ignored) |
| `npm run test:firefox` | downloads Firefox and geckodriver into `~/.cache/at-peace/` on the first run, then runs the specs in `tests/firefox/` |
| `npm run selectors` | checks every selector of every setting against saved page snapshots and writes `docs/selector-report.md`; `-- --live` uses live pages |
| `npm run start:firefox` | `web-ext run`: a throwaway Firefox profile with the extension loaded (`-- --firefox=/path/to/zen` for another browser) |
| `npm run build` | `web-ext build`: `web-ext-artifacts/at-peace-<version>.zip` |
| `npm run verify:package` | unzips the built package and checks that every file the manifest, pages and scripts refer to is inside, and that no dev files are |
| `npm run sign` | `web-ext sign --channel=unlisted` (see above) |

The PNG icons are generated from `icons/icon.svg` with `node tools/make-icons.mjs`.

### Tests, and what to expect from them

- **Unit tests** load the classic scripts into a fake browser; they need nothing else.
- **Chromium tests** build a Chrome variant of the manifest in a temp folder (Chrome has no event-page
  `scripts`), so the shipped manifest stays Firefox-first. They need Playwright; set `PLAYWRIGHT_PATH`
  to its `index.mjs` if it is not at the default location.
- **Firefox tests** run the real package (`web-ext build` output) in headless Firefox. Firefox is the
  product, so any feature that touches YouTube's DOM, the DNR rules or an extension page is checked
  there too.
- **YouTube without Google.** Google answers rapid page loads with a captcha (`/sorry/`) that sticks to an
  IP. Most tests therefore use offline copies of YouTube's pages (`tests/e2e/_yt-fixture.mjs` rebuilds
  `www.youtube.com` pages from `tests/e2e/artifacts/research/*.dom.json` and serves them with no traffic to
  Google). Those snapshots are local files, not in the repository: write them with
  `node tools/yt-probe.mjs <url> --dom tests/e2e/artifacts/research/<name>.dom.json`. Without them the
  tests that need them are skipped, with a message saying so.
- **Live tests** (a few specs open the real site) are paced and **skip**, never fail, when Google serves
  the captcha (`/sorry/`, or an HTTP 429) or serves a page without the part the test needs (no sidebar
  entries, no search results). The skip message says which. A failure on a page that rendered normally is
  still a failure.
- **Also in the Chromium run:** `tests/e2e/a11y.spec.mjs` (axe-core on every extension page, plus a keyboard
  walk) and `tests/e2e/perf.spec.mjs` (startup, CPU in our scripts while a page grows, leaks across 20
  navigations; numbers in [docs/PERFORMANCE.md](docs/PERFORMANCE.md)). In real Firefox,
  `tests/firefox/catalog.mjs` turns on one representative setting per section of the catalog on page
  snapshots and checks what disappears and what must stay.
- **Writing a wait.** Never `page.waitForFunction(async () => …)`: Playwright does not await a promise
  returned by that predicate, so the wait passes at once. Poll from Node instead with `until()` or
  `pageUntil()` from `tests/helpers/wait.mjs`, which await every check.

### Project layout

```
manifest.json            Firefox MV3 manifest (the shipped one)
web-ext-config.mjs       what goes into the package (manifest, icons/, src/)
src/
  shared/                classic scripts loaded everywhere: namespace, util, schema-core, settings,
                         state, presets, lock, messages; schema/ holds the cross-site settings
  sites/youtube/
    schema/              the YouTube settings, one file per section (the catalog)
    features/            JavaScript behaviours (autoplay, speed, filters, redirects...)
    page.js, redirects.js, bridge-client.js, page-bridge.js (MAIN world), main.js
  content/               site-agnostic engine, overlay, element picker, guard
  background/            event page: message router, sessions, rules (DNR), stats, guards
  pages/                 popup, options, pause, blocked, welcome, and common/ (tokens, base, components)
icons/                   icon.svg and generated PNGs
tests/                   unit/, e2e/ (Chromium), firefox/ (real Firefox), helpers/ (wait.mjs, instrument.js)
tools/                   yt-probe.mjs, check-selectors.mjs, make-icons.mjs, verify-package.mjs
docs/                    PLAN.md (design), youtube-dom.md (selector research), selector-report.md,
                         VERIFY.md, PERFORMANCE.md, IDEAS.md, reviews/
```

### How hiding works, in a paragraph

At `document_start` the content script injects one stylesheet, compiled from the schema, in which every
rule is gated by a token on `<html>`: `html[data-at-peace~="yt.comments.hideAll"] ytd-comments { display:
none !important }`. Turning a setting on or off is one attribute write, so it is instant, works on content
that loads later and survives YouTube's own navigation. Rules that belong to one kind of page are also
gated by `data-at-peace-page`. Anything that needs logic (redirects, autoplay, filters) is a *feature*
that the engine starts and stops with its settings.

### Add a setting

Every option is declared once, in a schema file; the options page, the popup toggles, presets, search,
validation and the CSS all come from that declaration.

1. Pick the section file in `src/sites/youtube/schema/` (or `src/shared/schema/` for cross-site
   settings) and add an entry to its `AP.schema.define(...)` list:

   ```js
   {
     id: 'yt.comments.hideExample',      // stable forever; never rename after a release
     group: 'Details',
     label: 'Hide something',              // short, plain
     description: 'One sentence about what disappears.',
     type: 'toggle',                       // toggle | select | number | text | textarea | list | object
     default: false,
     tags: ['comments'],                   // bulk chips: shorts, recommendations, comments, ai, metrics, ads, clutter
     page: 'watch',                        // optional: only on this page type
     hide: ['ytd-comments #example'],      // one selector per entry; set to display:none while on
     since: '0.2.0',
   }
   ```

   Selects use `variants` (per-value CSS), toggles that need more than `display:none` use `rules`
   with the `:scope-on` placeholder, and a setting that needs code instead of CSS names a `feature`.
2. Selectors follow the rules in `docs/PLAN.md` section 6.2: custom element tags and stable ids first,
   no visible text, anchor any `:has()`, hide the container and not its contents.
3. Run `npm test`. `validateRegistry()` fails on duplicate ids, unknown tags or pages, bad defaults and
   selector lists with top-level commas, and the preset check lists any preset that points at an unknown id.
4. If it is a behaviour, add a file in `src/sites/youtube/features/` and list it in the `content_scripts`
   array of `manifest.json` (before `src/sites/youtube/main.js`). `npm test` fails when the manifest, the
   Chrome test service worker and the pages' script tags disagree (`tests/unit/manifest.test.mjs`).
5. Add it to a preset (`src/shared/presets.js`) only when it belongs there.

### Update a broken selector

YouTube changes its page. When something stops hiding:

1. Look at the live page: `node tools/yt-probe.mjs /watch?v=<id> --root '#secondary' --depth 5`
   prints a collapsed outline of the DOM. `--count '<selector>'` counts matches; `--dom file.dom.json`
   saves an exact snapshot you can re-run offline (`node tools/yt-probe.mjs file.dom.json --count ...`).
   Use `--profile <dir> --headed` once to sign in if the element is only there when signed in.
2. Fix the selector in the schema file, keeping the old variant as well when both versions may still
   be served (legacy and view-model renderers coexist).
3. Check it: `npm run selectors` (offline, against the snapshots) or `npm run selectors -- --live`.
   The report lists selectors that match nothing where they should, selectors that are invalid, and
   selectors that match something they must never hide (the page, the app shell, most of the screen).
4. Add the observation to `docs/youtube-dom.md` (where it was seen, live or not).

The tools need Playwright (see above for `PLAYWRIGHT_PATH`) and, on Google's side, patience: more than
about ten loads in a few minutes brings the captcha.

## Privacy

Nothing leaves the browser. At Peace stores your settings, presets and 90 days of usage numbers in the
browser's local extension storage, makes no network requests of its own, and has no analytics. The full
statement, what is stored and how to clear it: [PRIVACY.md](PRIVACY.md).

## More

- [docs/PLAN.md](docs/PLAN.md): the design and conventions every change follows.
- [docs/VERIFY.md](docs/VERIFY.md): the 10 to 15 minute checklist to run in Zen.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): what it costs on a page.
- [docs/IDEAS.md](docs/IDEAS.md): what could come next.
- [CHANGELOG.md](CHANGELOG.md).
