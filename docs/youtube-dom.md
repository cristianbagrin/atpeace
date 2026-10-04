# YouTube DOM reference (Phase 1 research)

> Selector research for **At Peace** (PLAN §6). Everything here was observed on
> **2026-10-04** with Chromium 141 (Playwright) on `www.youtube.com`, English UI, **logged out**,
> 1440×900 (web client build `2.20261002.01.00`, `ytcfg.LOGGED_IN=false`, `hl=en`, `gl=US`). Tool: `tools/yt-probe.mjs` (reusable; see "Re-running the research" at the end).
> Raw dumps/screenshots live in `tests/e2e/artifacts/research/` (git-ignored); file names are
> cited below.

## 0. Read this first (what could NOT be done, and why it matters)

| Limit | Consequence |
|---|---|
| **No video playback in the sandbox.** `*.googlevideo.com` is blocked by the container proxy (HTTP 502 on CONNECT) and YouTube answers the player with "Sign in to confirm you're not a bot" (`errorCode:"auth"`, a `.ytp-gated-actions-overlay` interstitial). | Player-runtime DOM was observed only in its **unstarted/error state**: no ads, no end screen/autoplay countdown, no "Are you still watching?" dialog, no hover preview, no `ended-mode`. `setAutonav()`/`pauseVideo()` were callable but their *effect* could not be confirmed. |
| **Logged out + no watch history.** The home feed is empty ("Try searching to get started", `ytd-feed-nudge-renderer`). `/feed/subscriptions`, `/feed/history`, `/feed/you` show sign-in promos. | **No home grid cards, no home shelves, no chip bar content, no subscriptions feed, no logged-in masthead/guide** were observed. Those selectors are `[source]`/`[inferred]` unless the same component is visible elsewhere (the home card is the same `yt-lockup-view-model` as on channel `/videos`; the legacy `ytd-rich-grid-media` card is live on `/hashtag/…`). |
| **Google rate-limits automated loads** (`google.com/sorry` captcha after ~10–15 page loads in a few minutes; it also latched per-video: `dQw4w9WgXcQ`, `jfKfPfyJRdk` were refused while other videos loaded). | Pages were captured sequentially with 40–60 s pauses. The probe reports `/sorry/` when it happens. Do not run `check-selectors` in a tight loop. |
| One locale (en-US), one A/B bucket per page. | Localised strings are visible in the dumps (`title="Shorts"`, `tab-title="Videos"`); they are listed only to explain **why text-based selectors are rejected**. Some pages use legacy renderers that others have replaced (see §1) — YouTube serves different buckets. |

Provenance tags used for **every** selector below:

* **[live]** — the selector matches element(s) in a snapshot of the live page taken on 2026-10-04 (logged out). The match counts of the snapshots are quoted (`dump-name N`). Snapshots are exact DOM trees (`*.dom.json`, written by `yt-probe --dom`), so structural combinators (`>`, `:has()`) are reliable. Older `*.html` dumps were re-parsed by an HTML parser and **can mis-nest elements** (invalid HTML such as `<a>` in `<a>` is re-parented); I only trust those for single-element facts.
* **[live-structure]** — the container/parent was observed live, the specific child is inferred or was not present in the sample (e.g. position-based selectors, hidden elements).
* **[source: X]** — taken from public open-source code, **unverified live** (logged-in-only UI or not in the sample). X is one of:
  * `RYS` = `lawrencehook/remove-youtube-suggestions` — `src/content-script/main.css` and `main.js` (fetched 2026-10-04 from `main`),
  * `yt-neuter` = `mchangrh/yt-neuter` — `yt-neuter.txt` (`Last modified: 2026/02/08`) and `filters/sponsorblock.txt` (2025/12/17),
  * `gijsdev` = `gijsdev/ublock-hide-yt-shorts` — `list.txt` (`Last modified: 2026-04-29`),
  * `easylist` (`easylist_specific_hide.txt`), `AdGuard` (Annoyances filter), `Fanboy`,
  * `author knowledge` — a name I recall from YouTube's DOM that appears in none of the fetched lists (weakest source).
* **[inferred]** — my own structural inference, never matched live; treat as a hypothesis to be confirmed by `npm run selectors` / a logged-in run.
* Selectors flagged **TEXT-BASED** match localised strings (`title="Shorts"`, `aria-label=Share`, `tab-title="Posts"`). They violate PLAN §6.2 rule 2 and are listed only so you can see what the community uses; **do not ship them**.

---

## 1. App structure (observed)

```
html[lang]  (dark theme: html[dark] per RYS, not observed)        body[dir]
└ ytd-app[ guide-persistent-and-visible | mini-guide-visible | is-watch-page | is-shorts-page ]
  ├ yt-guide-manager, yt-mdx-manager, yt-playlist-manager, yt-hotkey-manager      (no UI)
  ├ ytd-miniplayer.ytdMiniplayerComponentHost
  ├ div#content
  │  ├ div#frosted-glass.with-chipbar|.without-chipbar        masthead backdrop (height depends on a chip bar)
  │  ├ div#masthead-container
  │  │  └ ytd-masthead#masthead[logo-type][frosted-glass-mode]
  │  │       div#start   : yt-icon-button#back-button, yt-icon-button#guide-button (burger),
  │  │                     ytd-topbar-logo-renderer#logo (a#logo[href="/"], span#country-code, ytd-yoodle-renderer[hidden]),
  │  │                     div#skip-navigation
  │  │       div#center  : yt-searchbox (input[name=search_query], .ytSearchboxComponentSuggestionsContainer[role=listbox]),
  │  │                     yt-icon-button#search-button-narrow, div#voice-search-button, div#ai-companion-button[hidden]
  │  │       div#end     : div#buttons  — logged out: ytd-topbar-menu-button-renderer (3-dot Settings), ytd-button-renderer (Sign in)
  │  ├ tp-yt-app-drawer#guide[role=navigation]
  │  │    #contentContainer > #guide-wrapper > #guide-content > #header (burger+logo, drawer mode) + #guide-inner-content
  │  │      > ytd-guide-renderer#guide-renderer > #sections (ytd-guide-section-renderer × n, ytd-guide-signin-promo-renderer) + #footer
  │  ├ ytd-mini-guide-renderer[hidden]           (#items filled lazily; shown when the guide is collapsed)
  │  └ ytd-page-manager#page-manager
  │       ├ ytd-browse[page-subtype=…]     home | subscriptions | channels | history | you | playlist | hashtag-landing-page | …
  │       ├ ytd-search[page-subtype=search]
  │       ├ ytd-watch-flexy                (always in the DOM, `hidden` on other pages!)
  │       └ ytd-shorts
  ├ ytd-popup-container, snackbar-container, yt-tooltip, yt-ephemeral-actions
  └ div#video-preview > ytd-video-preview-loader     (hover-preview host)
```

Facts that shape selector design:

* **Inactive pages stay in the DOM.** On every non-watch load `ytd-watch-flexy` exists with `hidden` (it contains the whole player DOM: `.ytp-*` selectors match on the home page too). After SPA navigations earlier `ytd-browse` pages also linger, hidden. ⇒ **always page-gate** (`data-at-peace-page`) and never rely on "selector matches ⇒ user sees it".
* `ytd-app` carries page markers: `is-watch-page`, `is-shorts-page`; `guide-persistent-and-visible` (wide viewports, guide docked) or `mini-guide-visible` (collapsed). Layout reacts to these (see `yt.guide.hideAll`).
* `ytd-browse[page-subtype]` values seen: `home`, `subscriptions`, `channels` (all channel tabs), `history`, `you`, `playlist`, `hashtag-landing-page`. `ytd-search[page-subtype="search"]`. `ytd-shorts` has no subtype.
* `/feed/trending` and `/feed/explore` **redirect to `/`** (title "Home") — Trending was retired; there is no explore/trending page type any more.
* YouTube is **mid-migration** between three component generations. All three are live on different pages today:

| Generation | Examples | Where seen live (2026-10-04) |
|---|---|---|
| Polymer renderers `ytd-*` (BEM-less `#id` + `style-scope ytd-x` classes) | `ytd-video-renderer`, `ytd-shelf-renderer`, `ytd-rich-grid-media`, `ytd-thumbnail`, `ytd-menu-renderer`, `ytd-comment-view-model`, `ytd-guide-entry-renderer`, `ytd-playlist-panel-video-renderer` | search results (`ytd-video-renderer` ×20), search shelves, `/hashtag/…` cards (`ytd-rich-item-renderer > ytd-rich-grid-media` ×36), guide, comments, watch metadata, playlist panel |
| View models (camelCase BEM-like classes, custom elements without `ytd-`) | `yt-lockup-view-model` (+ `.ytLockupViewModelHost`, `.ytLockupMetadataViewModelTitle`, `.ytContentMetadataViewModel…`), `yt-thumbnail-view-model`, `grid-shelf-view-model`, `ytm-shorts-lockup-view-model(-v2)`, `yt-collection-thumbnail-view-model`, `chip-bar-view-model`, `yt-page-header-view-model`, `like-button-view-model`, `segmented-like-dislike-button-view-model`, `reel-action-bar-view-model`, `yt-reel-player-overlay-view-model` | channel Home/Videos/Shorts, `/playlist`, watch sidebar, Shorts shelves in search, channel header, like/dislike, Shorts player overlay |
| `ytw-*` / `yt-*` "web" renderers (new tag prefix) | `ytw-thumbnail-overlay-resume-playback-renderer`, `ytw-pinned-comment-badge-renderer`, `ytw-timely-actions-overlay-view-model`, `yt-section-list-renderer`, `yt-item-section-renderer`, `yt-continuation-item-view-model` | resume bar in search thumbnails, comments, `/playlist` page lists |

  Consequence for the schema: **tag-name selectors need both generations** (`ytd-thumbnail-overlay-resume-playback-renderer` *and* `ytw-thumbnail-overlay-resume-playback-renderer`), and class names changed from BEM `yt-spec-button-shape-next__button-text-content` to camelCase `ytSpecButtonShapeNextButtonTextContent` (the old name has **0** matches today; RYS still uses it).

* Where each *video-card* renderer is used today:

| Renderer | Seen on |
|---|---|
| `ytd-rich-item-renderer > #content > yt-lockup-view-model` (vertical) | channel `/videos` (30), channel Home shelves; the home grid very likely uses it too (same `ytd-rich-grid-renderer`) — **unverified, home was empty** |
| `ytd-rich-item-renderer > #content > ytd-rich-grid-media` (legacy) | `/hashtag/cooking` (36) — **legacy still alive** |
| `ytd-rich-item-renderer[is-slim-media] > … ytm-shorts-lockup-view-model-v2` | channel `/shorts` (45) |
| `yt-lockup-view-model` (horizontal compact) | watch sidebar (`#related`, 26/load), `/playlist` page (54) |
| `ytd-video-renderer` | search results (20–21), `ytd-shelf-renderer` "Latest from X" inside search |
| `ytd-playlist-panel-video-renderer` | watch-page playlist/queue panel (54) |
| `ytd-compact-video-renderer`, `ytd-grid-video-renderer`, `ytd-playlist-video-renderer`, `ytd-reel-shelf-renderer`, `ytd-reel-item-renderer`, `ytd-compact-radio-renderer`, `ytd-radio-renderer`, `ytd-comment-renderer` | **0 matches** in every snapshot (replaced) — keep selectors as legacy variants only |
| `grid-shelf-view-model > … ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model` | Shorts shelves in search (3 per query) |

Page-type signals (for `AP.yt.page.detect` / SPA tracking) — details in §4.1.

---

## 2. Card / item anatomy (feeds)

Needed by the keyword/channel filters (`yt.filters.*`), thumbnail modes, metric hiding and `hideWatched`.
All sub-selectors below were **run against the live snapshots** (`anat.mjs`): "n/N" is how many items of
that surface contained the element. Selectors are relative to the item element. **Hide the *item* element** for
filters (never an inner part) so the grid/list reflows without holes.

### 2.1 Search results — `ytd-video-renderer` (legacy renderer, still used) [live: search-lofi 21, search-mrbeast 20]

Parent: `ytd-search ytd-section-list-renderer #contents > ytd-item-section-renderer #contents` (also inside `ytd-shelf-renderer … ytd-vertical-list-renderer #items`).

| Datum | Selector (inside the item) | Notes (n/N lofi) |
|---|---|---|
| title text | `a#video-title` (text in its `yt-formatted-string`; attr `title` = full title; `aria-label` = title + duration + views, localised) | 21/21 |
| video link | `a#video-title[href^="/watch"]` (also `ytd-thumbnail a#thumbnail[href]`) | 21/21; `a#thumbnail` text also contains "Now playing" overlay text — use the title anchor for text |
| thumbnail img | `ytd-thumbnail img` (inside `yt-image`) | 21/21; `src=https://i.ytimg.com/vi/<ID>/…` ⇒ the video id is in the URL too |
| duration | `ytd-thumbnail-overlay-time-status-renderer .ytBadgeShapeText` (legacy `#text`, hidden) | 18/21 — the 3 without are live streams: they have **no** `ytd-thumbnail-overlay-time-status-renderer` at all |
| channel name | `ytd-channel-name#channel-name a` (text) / `#channel-name #text` | 21/21 |
| channel link | `a` inside `ytd-channel-name` → `/@handle` **or** `/channel/UC…` (both observed: lofi → `/channel/UCSJ4…`, rice → `/@gordonramsay`) — a handle filter must accept both | 21/21 |
| avatar | `#channel-info a#channel-thumbnail img` | 21/21 |
| views / date | `#metadata-line span.inline-metadata-item` — 1st = views (or "N watching" for live), 2nd = date | 21/21 |
| description snippet | `.metadata-snippet-text` (+ `.metadata-snippet-container`) | 21/21 |
| watched-progress bar | `ytw-thumbnail-overlay-resume-playback-renderer` (in `ytd-thumbnail #overlays`) **and** `yt-thumbnail-overlay-progress-bar-view-model` (in `yt-thumbnail-bottom-overlay-view-model`) — both live on search ("how to cook rice": 2 results) | |
| badges (LIVE/New/4K/CC) | `#badges ytd-badge-supported-renderer yt-badge-supported-renderer`; chip shapes `badge-shape.ytBadgeShapeLive` (LIVE) / `.ytBadgeShapeDefault` (New). Verified-artist check = `…StyleTypeVerifiedArtist` | LIVE chip live on 3/21 |
| chapters row ("68 chapters") | `ytd-expandable-metadata-renderer` inside `#expandable-metadata` | |

Other result kinds in `ytd-item-section-renderer #contents` (observed, in page order for "lofi"): `ytd-channel-renderer` (name `#text`, link `a#main-link[href]`, `@handle • subs` in `#subscribers`, avatar `#avatar img`, `#description`), `ytd-shelf-renderer` ("Latest from X": `#title`, contains `ytd-video-renderer`s; also "Latest posts from X"), `grid-shelf-view-model` (Shorts shelf, below), then the `ytd-video-renderer` list; Shorts shelves are interleaved every ~8–16 results.

### 2.2 Shorts shelf in search — `grid-shelf-view-model` [live: search-lofi 3, search-mrbeast 1, search-rice 3]

```
grid-shelf-view-model.ytGridShelfViewModelHost[.ytGridShelfViewModelHostHasBottomButton]
  yt-section-header-view-model … h2.ytShelfHeaderLayoutTitle           "Shorts" | "Latest Shorts from X" | custom ("Rice Cooking Guide✨")
  div > div.ytGridShelfViewModelGridShelfRow > div.ytGridShelfViewModelGridShelfItem × 5
        ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model
            a.shortsLockupViewModelHostEndpoint.reel-item-endpoint[href="/shorts/<ID>"]   thumbnail: yt-thumbnail-view-model img (2:3)
            div.shortsLockupViewModelHostOutsideMetadata
                h3.shortsLockupViewModelHostMetadataTitle > a (title)      .shortsLockupViewModelHostOutsideMetadataSubhead ("16K views")
  div.ytGridShelfViewModelGridShelfBottomButtonContainer button ("Show more")     — only on some shelves
```
* A Shorts shelf is recognised **language-free** by `:has(ytm-shorts-lockup-view-model)` or `:has(a[href^="/shorts/"])`. The title is custom text, never "Shorts" only; the first shelf of "how to cook rice" has no bottom button (RYS's `…HasBottomButton` selector misses it).
* Shorts cards carry no channel name in this context; only title, views, id (`/shorts/<ID>`), thumbnail (`i.ytimg.com/vi/<ID>/oar2.jpg…`), and a "New" badge (`yt-badge-view-model`).

### 2.3 Rich-grid card (home / channel Videos / subscriptions) — `ytd-rich-item-renderer` [live: channel-videos 30, channel-home, hashtag 36]

Grid: `ytd-two-column-browse-results-renderer #primary > ytd-rich-grid-renderer[elements-per-row] > #contents > (ytd-rich-item-renderer | ytd-rich-section-renderer | ytd-continuation-item-renderer)`.

**Current (view-model) card** — `ytd-rich-item-renderer[rendered-from-rich-grid][lockup="true"] > #content > yt-lockup-view-model > .ytLockupViewModelHost.ytLockupViewModelVertical` [live: channel-videos 30/30]:

| Datum | Selector (inside the `ytd-rich-item-renderer`) | Notes |
|---|---|---|
| title text | `a.ytLockupMetadataViewModelTitle` (text in `span.ytAttributedStringHost`; `aria-label` = full title) | 30/30 |
| video link | `a.ytLockupViewModelContentImage[href]` (thumbnail link) and the title anchor; `/watch?v=<ID>` or `/shorts/<ID>` | 30/30; the host div also has class `content-id-<ID>` |
| thumbnail | `.ytThumbnailViewModelImage img` (`i.ytimg.com/vi/<ID>/…`) | 30/30 |
| duration | `yt-thumbnail-bottom-overlay-view-model badge-shape .ytBadgeShapeText` (for LIVE the text is "LIVE" and the badge has class `ytBadgeShapeThumbnailLive`) | 30/30 |
| channel name + link | `.ytContentMetadataViewModelMetadataText a[href]` (the channel row; plain text without link on some layouts; absent on channel `/videos`) — **not present in the watch sidebar variant** | home-tab shelves: 6/12 |
| avatar | `.ytLockupMetadataViewModelAvatar img` (home/watch-sidebar layouts; absent on channel `/videos`) | |
| views / date | `.ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter)`: 1st `.ytContentMetadataViewModelMetadataText` = views ("38M", aria-label "38 million views"), `.ytContentMetadataViewModelMetadataTextLastPart` = date | 30/30 |
| badges | `.ytContentMetadataViewModelBadge badge-shape` (CC, New, 4K…) in a 3rd metadata row; verified tick = `.ytContentMetadataViewModelIcon` after the channel name | |
| progress bar | `yt-thumbnail-overlay-progress-bar-view-model` (not present in the logged-out sample) | |

**Legacy card** — `ytd-rich-item-renderer > #content > ytd-rich-grid-media > #dismissible` [live: hashtag 36/36]:
title `a#video-title-link` (text `yt-formatted-string#video-title`), thumbnail link `ytd-thumbnail a#thumbnail[href]` (+ img), duration `ytd-thumbnail-overlay-time-status-renderer .ytBadgeShapeText`, channel `ytd-channel-name#channel-name a`, avatar `#avatar-container img`, meta `#metadata-line span.inline-metadata-item` (views, date). A **Short appears as a normal card** here: `a#thumbnail[href^="/shorts/"]` and `ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]` (33/36 on `/hashtag/cooking`).

The **subscriptions feed** uses the same `ytd-rich-grid-renderer` (grid view) — it only shows a sign-in promo logged out (`ytd-item-section-renderer > ytd-background-promo-renderer`), so card details are presumed identical to home/channel and are **unverified**.

**Shorts card in a grid** (channel `/shorts`): `ytd-rich-item-renderer[is-slim-media] > #content > ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model` [live: channel-shorts 45/45]: link `a.shortsLockupViewModelHostEndpoint[href^="/shorts/"]`, title `.shortsLockupViewModelHostMetadataTitle a`, views `.shortsLockupViewModelHostOutsideMetadataSubhead`, thumb `yt-thumbnail-view-model img`.

### 2.4 Watch sidebar — `#related yt-lockup-view-model` (compact horizontal) [live: watch-chapters 26, watch-live 26, watch-playlist 26]

Parent: `ytd-watch-flexy #secondary-inner #related ytd-watch-next-secondary-results-renderer #items ytd-item-section-renderer #contents`; the cards are **direct** `yt-lockup-view-model` children (no `ytd-compact-video-renderer`). Lists grow by continuation (110 cards after scrolling on a music video).

| Datum | Selector | n/N |
|---|---|---|
| title | `a.ytLockupMetadataViewModelTitle` | 26/26 |
| link | `a.ytLockupViewModelContentImage[href]` — `/watch?v=ID` (+ `&list=RD…&start_radio=1` on 21/26 cards: **not** a Mix, see hideMixes) | 26/26 |
| thumbnail | `.ytThumbnailViewModelImage img` | 26/26 |
| duration / LIVE | `yt-thumbnail-bottom-overlay-view-model badge-shape .ytBadgeShapeText` ("3:24" / "LIVE"); LIVE has `.ytBadgeShapeThumbnailLive` (5/26 on the lofi page) | 26/26 |
| channel name | `.ytContentMetadataViewModelMetadataRow:nth-of-type(1) .ytContentMetadataViewModelMetadataText` — **plain text, no link** (0/26 anchors) ⇒ channel filters here can match the *name* only, never `@handle` | 26/26 |
| avatar | `.ytLockupMetadataViewModelAvatar` → `img` inside a `[role=button]` div (not a link) | 26/26 |
| views / date | row with delimiter (21/26; live shows "N watching" and no date) | |
| Mix / playlist / station | extra `.ytLockupViewModelCollectionStack2` and `yt-collection-thumbnail-view-model` | 1/26 on watch-music (a "STATION"), 1/26 on watch-playlist (a course playlist), 3/110 on the Rick page |

The playlist/queue panel is separate: `ytd-playlist-panel-renderer#playlist > … #items > ytd-playlist-panel-video-renderer` (54/54 on `watch-playlist`): title `#video-title`, link `a#wc-endpoint[href]`, channel `#byline`, duration `#overlays .ytBadgeShapeText`.

### 2.5 `/playlist` page items — `yt-lockup-view-model` in `yt-item-section-renderer #contents > div` [live: playlist 54/54]
Horizontal lockup, title/link/duration as above; the channel appears as a **link** `.ytContentMetadataViewModelMetadataText a[href]` (54/54). Header: `yt-page-header-view-model` (title, owner, description, actions). Playlist-card thumbnails in the sidebar use legacy `ytd-playlist-thumbnail`.

### 2.6 Comments — `ytd-comments#comments ytd-comment-thread-renderer` [live: watch-chapters 20/20, watch-playlist 20]

```
ytd-comment-thread-renderer
  #comment-container > ytd-comment-view-model#comment
      #paid-comment-background, #linked-comment-badge
      #body
        #author-thumbnail > button#author-thumbnail-button (aria-label="@handle") > yt-img-shadow > img      avatar (+ .threadline for replies)
        #main
          #header
            #pinned-comment-badge > ytw-pinned-comment-badge-renderer                       (0/20 here; 1 on the Rick page)
            #header-author: h3 > a#author-text[href="/@handle"] > span "@handle" ; #author-comment-badge (creator ✓) ; #sponsor-comment-badge
                            span#published-time-text > a[href^="/watch?v=…&lc=…"] ("8 months ago")
          ytd-expander#expander > #content > yt-attributed-string#content-text > span       comment text (plain; #more "Read more")
          ytd-comment-engagement-bar#action-buttons > #toolbar
              ytd-toggle-button-renderer#like-button button ; span#vote-count-middle ("538") ; ytd-toggle-button-renderer#dislike-button
              #creator-heart > ytd-creator-heart-renderer ; ytd-button-renderer#reply-button-end
      #action-menu > ytd-menu-renderer (hidden dots)
  #replies  (collapsed reply thread: "12 replies" toggle + list)
```
Header (`ytd-comments-header-renderer`): count `h2#count`, sort `#sort-menu`, "Add a comment" box `ytd-comment-simplebox-renderer` (own `#author-thumbnail`, `#placeholder-area`). The same elements exist inside engagement panel `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` (Shorts, narrow layouts). Community posts (`ytd-backstage-post-thread-renderer`, channel `/posts`, 10/10) reuse `#author-text`, `#content-text`, `#vote-count-middle`, `#published-time-text a[href^="/post/"]`, `ytd-backstage-image-renderer img`.

### 2.7 Watch page metadata — `ytd-watch-metadata` [live: watch-chapters]

| Datum | Selector |
|---|---|
| title | `#title h1 yt-formatted-string` |
| owner link / name | `#owner ytd-video-owner-renderer a[href]` (`/@handle`) ; `#owner ytd-channel-name #text a` |
| avatar | `#owner #avatar img` |
| subscribers | `#owner-sub-count` |
| Subscribe | `#subscribe-button button` ; Join `#sponsor-button` |
| like | `like-button-view-model button` (count in `.ytSpecButtonShapeNextButtonTextContent`) ; dislike `dislike-button-view-model` ; capsule `segmented-like-dislike-button-view-model` |
| other actions | `#top-level-buttons-computed > yt-button-view-model` (Share), `#flexible-item-buttons > ytd-download-button-renderer`, `… > yt-button-view-model` (Save), `ytd-menu-renderer > yt-button-shape#button-shape` (…) |
| views / date / hashtags | `ytd-watch-info-text #view-count`, `#date-text`, `#info a[href^="/hashtag/"]` (view-count digits are an animated "rolling number": `textContent` is garbage, read `aria-label` instead) |
| description | `#description-inline-expander` (`#expand` = "…more", `#snippet`, `#expanded`) ; extras `ytd-structured-description-content-renderer #items` |
| comment teaser | `#comment-teaser` |

### 2.8 Filter / thumbnail implementation cheat-sheet (derived from 2.1–2.7)

| Surface | Element to hide (`data-at-peace-filtered`) | Where new items are inserted (MutationObserver root) | Text to match | Channel key |
|---|---|---|---|---|
| Search results | `ytd-video-renderer` (also inside `ytd-shelf-renderer`) | `ytd-search ytd-section-list-renderer #contents` (each continuation adds a `ytd-item-section-renderer`) | `a#video-title` `title` attr (full text) + `.metadata-snippet-text` | `ytd-channel-name a[href]` → `/@handle` or `/channel/UC…`; name text |
| Search Shorts shelf | `grid-shelf-view-model` (whole shelf) or `.ytGridShelfViewModelGridShelfItem` (one card) | same | `.shortsLockupViewModelHostMetadataTitle a` | none |
| Home / subscriptions / channel grid | `ytd-rich-item-renderer` (**never** the inner `yt-lockup-view-model`: the wrapper keeps a grid cell) | `ytd-rich-grid-renderer > #contents` | `a.ytLockupMetadataViewModelTitle` (lockup) / `a#video-title-link` (legacy) | `.ytContentMetadataViewModelMetadataText a[href]` (home) / `ytd-channel-name a` (legacy) |
| Watch sidebar | `#related yt-lockup-view-model` (direct child of `#contents`) | `ytd-watch-next-secondary-results-renderer #items ytd-item-section-renderer #contents` (+ continuation) | `a.ytLockupMetadataViewModelTitle` | row-1 text only (no link) |
| `/playlist` list | the `div` wrapper of the lockup: `yt-item-section-renderer #contents > div:has(> yt-lockup-view-model)` | `yt-item-section-renderer #contents` | `a.ytLockupMetadataViewModelTitle` | `.ytContentMetadataViewModelMetadataText a[href]` |
| Queue panel | `ytd-playlist-panel-video-renderer` (do not hide the *current* item) | `ytd-playlist-panel-renderer #items` | `#video-title` | `#byline` |
| Comments | `ytd-comment-thread-renderer` | `ytd-comments#comments ytd-item-section-renderer#sections #contents` | `#content-text` | `#author-text[href]` |

* All cards are inserted into an **already-existing** `#contents` container; one `MutationObserver` on `document` (PLAN §7) with `addedNodes` filtering on these tag names is enough. Re-run the filter on `yt-navigate-finish` because pages and their cards are cached and re-shown.
* Prefer `title` / `aria-label`-free text: `a#video-title[title]`, the text of `a.ytLockupMetadataViewModelTitle > span`. Normalise with `normalize('NFD')` + strip combining marks for diacritic-insensitive matching (PLAN §6.3).
* The video id is available in every card href (`/watch?v=<ID>`, `/shorts/<ID>`) and in the thumbnail URL (`i.ytimg.com/vi/<ID>/…`) — useful to key "already filtered" caches.

---

## 3. Per-setting catalog

Settings use the exact ids of PLAN §6.3, in the same order. Each entry gives: the recommended page scope (`page:`; omitted = all pages), **every candidate selector** (legacy + current variants) with its provenance tag and — for live selectors — the snapshots it matched (`dump N` = number of elements in that snapshot; at most three shown), and notes on side effects, holes and what **not** to hide. A selector list is meant to be compiled as **one rule per selector** (PLAN §4.2). Counts come from `*.dom.json` snapshots of 2026-10-04 (exact trees); a `[live]` selector with a count of 0 never appears in the final text (the generator flags it).

**Recommended defaults for the schema agent (Phase 2b)**

* Compile every selector as `html[data-at-peace~="<id>"][data-at-peace-page="<page>"] <selector>` — the engine already page-gates; never emit bare `.ytp-*` selectors (the whole player DOM exists, hidden, on every page).
* Hide the **item wrapper**, not an inner part (`ytd-rich-item-renderer`, `ytd-video-renderer`, the `div` wrapper of a lockup in `yt-item-section-renderer`, `ytd-rich-section-renderer` for shelves) so grids reflow without holes. Use `display:none !important`. Exception: thumbnails "hide" (use `visibility:hidden` on the image, keep layout) and the autoplay toggle (JS needs it).
* `:has()` and `:nth-child(n of S)` are used; both are in Firefox ≥ 121 / ≥ 113. They parsed and matched in Chromium 141 here; **not exercised in Firefox**.
* **Layout holes found in the CSS lab** (inject → `getBoundingClientRect` → screenshot, 2026-10-04):

| Rule | Result |
|---|---|
| hide `tp-yt-app-drawer#guide` only | `ytd-page-manager` stays at **x=240** (a 240 px gutter). Add `ytd-app[guide-persistent-and-visible] ytd-page-manager.ytd-app { margin-left:0 !important }` ⇒ x=0, w=1440. |
| hide `ytd-mini-guide-renderer` only (viewport 1100) | page-manager stays at **x=72**; add `ytd-app[mini-guide-visible] ytd-page-manager.ytd-app { margin-left:0 !important }` ⇒ x=0. |
| hide `ytd-watch-flexy #related` only | blank 412 px right column remains (`#secondary`). Hide `#secondary` too when it holds nothing else (guarded rule in `hideRelated`) ⇒ player grows to 1394×784. |
| hide comments (`ytd-comments#comments`, `#comment-teaser`) | `#below` 4107 → 174 px, no gap. |
| hide the home feed nudge | `ytd-browse` 176 → 40 px, no gap. |
| hide channel banner / trailer / home sections | header 436 → 264 px; `#primary` 1497 → 1211 / 780 px; no gaps. The trailer lives in the first home item-section, so "hide home shelves" removes it too. |
| hide search shelves / Shorts shelves / channel result | `#primary` 8911 → 7858 / 6867 / 8775 px; no gaps. |
| hide search `#chip-bar` only | header row stays 56 px (it also hosts the Filters button). |
| `html { filter: grayscale(1) }` + scroll 700 px | masthead stays fixed at y=0 in Chromium; Firefox untested (PLAN R4). |
| Share / Save / "…" via icon-path selectors | action row keeps only the like capsule, no gaps (see screenshots `lab-watch-buttons.png`). |
| hide guide entries Home/Shorts/History via href / no-href rules | exactly those three entries vanish (`lab-home-guide-entries.png`). |

**Coverage summary (computed from the catalog below)**

| Status | # | Settings |
|---|---|---|
| live-verified | 86 | `general.grayscale`, `general.thumbnails`, `general.disableHoverPreview`, `general.hideViewCounts`, `general.hideUploadDates`, `general.hideDurations`, `general.hideChannelAvatars`, `general.hideBadges`, `general.hideWatchedProgress`, `masthead.hideVoiceSearch`, `masthead.hideSearchSuggestions`, `masthead.hideSearchBar`, `masthead.hideCountryCode`, `masthead.hideAICompanion`, `masthead.hideMastheadAd`, `masthead.hideGuideButton`, `guide.hideAll`, `guide.hideMini`, `guide.hideHome`, `guide.hideShorts`, `guide.hideSubscriptionsEntry`, `guide.hideYouEntry`, `guide.hideHistory`, `guide.hideExploreSection`, `guide.hideMoreFromYouTube`, `guide.hideSettingsSection`, `guide.hideFooter`, `guide.hideSignInPromo`, `home.feedMode`, `home.hideOtherShelves`, `home.hideFeedNudge`, `watch.hideRelated`, `watch.hideLiveChat`, `watch.hideShoppingShelf`, `watch.hideTickets`, `watch.hideHashtags`, `watch.hideOwnerAvatar`, `watch.hideSubscriberCount`, `watch.hideJoinButton`, `watch.hideLikeCounts`, `watch.hideLikeButtons`, `watch.hideDownload`, `watch.hideMoreActions`, `watch.hideViewCount`, `watch.hideDescription`, `watch.hideChapters`, `watch.hideDescriptionExtras`, `watch.hideInfoPanels`, `watch.hideFundraiser`, `watch.hideAmbientMode`, `watch.autoTheater`, `watch.defaultSpeed`, `player.hideEndscreenWall`, `player.hideInfoCards`, `player.hidePaidPromotion`, `player.hideAutoplayToggle`, `player.hideNextButton`, `player.hideCastButton`, `player.hideSubtitlesButton`, `player.hideChapterTitle`, `player.hideProgressPreviews`, `comments.hideAll`, `comments.hideTeaser`, `comments.hideCount`, `comments.hideAvatars`, `comments.hideLikeCounts`, `comments.hideReplies`, `comments.hideCreatorHearts`, `search.hideShorts`, `search.hideShelves`, `search.hideSnippets`, `search.hideFilterChips`, `search.hideAISummary`, `search.hideChannelResults`, `shorts.hideComments`, `shorts.hideLikeCounts`, `shorts.hideRemix`, `shorts.hideSubscribe`, `channel.hideTrailer`, `channel.hideHomeShelves`, `channel.hideSubscriberCount`, `channel.hideBanner`, `filters.commentKeywords`, `general.hideWatched`, `general.calmTitles`, `shorts.mode` |
| partly live (see notes) | 7 | `masthead.hideDoodle`, `watch.hidePlayerAds`, `watch.hideShare`, `watch.hideSave`, `watch.hideAISummary`, `watch.disableAutoplay`, `general.hideAds` |
| live-structure only | 5 | `home.hideChips`, `player.hideEndscreenCards`, `player.hideWatermark`, `subs.hideWatched`, `general.hideMixes` |
| source / inferred only | 25 | `masthead.hideNotifications`, `guide.hidePlaylists`, `guide.hideYourVideos`, `guide.hideWatchLater`, `guide.hideLiked`, `guide.hideDownloads`, `guide.hideCourses`, `guide.hideSubscriptionsSection`, `home.hideShortsShelf`, `home.hideNewsShelf`, `home.hidePostsShelf`, `watch.hideRelatedShorts`, `watch.hideRelatedChips`, `watch.hideClip`, `watch.dismissStillWatching`, `player.hidePauseOverlay`, `player.hideMiniplayerButton`, `search.hideRelatedSearches`, `search.hideAds`, `subs.hideShorts`, `subs.hidePosts`, `subs.hideLive`, `subs.hideUpcoming`, `general.hidePremiumUpsells`, `general.hidePlayables` |
| GAP (no language-free selector) | 6 | `masthead.hideCreate`, `watch.hideThanks`, `watch.hideAsk`, `channel.hideShortsTab`, `channel.hidePostsTab`, `channel.hideStoreTab` |
| player API (unverified effect) | 1 | `watch.noAutoStart` |
| JS / no selector | 5 | `home.redirectUrl`, `channel.openVideosTab`, `filters.keywords`, `filters.channels`, `filters.applyTo` |
| infeasible in CSS | 1 | `home.limitRows` |
| recommend dropping | 1 | `general.hideLiveBadgesAndPremieres` |

Total: 137 setting ids = the 136 ids of PLAN §6.3 (minus the cross-site `general.enabled/theme` and `advanced.*`) + 1 proposed (`search.hideAISummary`). "live-verified" means at least one language-free selector of the setting matched an exact snapshot (or was exercised in the CSS lab); it does not mean every selector of the setting is live — read the per-selector tags.

### General

#### `yt.general.grayscale`

- `html` — **[live]** · (applies to every page) — rule: `html { filter: grayscale(1) }`; see notes

Not a hide rule. Apply `filter: grayscale(1)` to `html` (or `ytd-app`). Chromium keeps `position:fixed` descendants fixed when the root has a filter; verify in Firefox (PLAN R4). Do NOT put the filter on `body` (creates a containing block, breaks fixed masthead / player).

#### `yt.general.thumbnails`

- `yt-thumbnail-view-model .ytThumbnailViewModelImage > img` — **[live]** · live: playlist 54, channel-shorts 45, channel-videos 30, +8 more snapshots — new lockups (home/channel/playlist/watch sidebar); apply filter to the img so overlay badges (duration) stay crisp
- `ytm-shorts-lockup-view-model yt-thumbnail-view-model .ytThumbnailViewModelImage > img` — **[live]** · live: channel-shorts 45, search-lofi 20, search-rice 20, +1 more snapshots — Shorts cards (already covered by the generic selector above; listed for clarity)
- `ytd-thumbnail yt-image > img` — **[live]** · live: watch-playlist 54, hashtag 36, search-lofi 21, +3 more snapshots — legacy renderer still used by search results (ytd-video-renderer), shelves, video-wall
- `ytd-thumbnail img` — **[live]** · live: watch-playlist 54, hashtag 36, search-lofi 21, +3 more snapshots — broader legacy fallback
- `ytd-playlist-thumbnail img` — **[live-structure]** · live: playlist 1 — playlist cards (legacy)
- `yt-collection-thumbnail-view-model img` — **[live]** · live: watch-music 1, watch-playlist 1 — stacked playlist/mix thumbnails in lockups
- `ytd-moving-thumbnail-renderer` — **[source: author knowledge]** — animated thumbnail on hover (legacy)
- `.ytp-modern-videowall-still-image` — **[live]** · live: watch-chapters 12, watch-live 12, watch-music 12, +1 more snapshots — end-of-video wall stills (background-image div, not img): use filter on the div
- `.ytp-videowall-still-image` — **[source: yt-neuter]** — legacy end-wall stills
- `.ytp-ce-covering-image` — **[live-structure]** — creator end-screen element images (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)

Modes = per-value CSS on the same element set: blur => `filter: blur(14px)`, grayscale => `filter: grayscale(1)`, hide => `visibility:hidden` (keeps the card layout stable; display:none would collapse the grid). "Reveal on hover" = `:scope-on yt-lockup-view-model:hover .ytThumbnailViewModelImage > img { filter:none }`. Do NOT target `img` inside `yt-avatar-shape` (avatars) or `#movie_player` (the video). Watch-page background `ytd-thumbnail.player-container-background-image` is also matched by `ytd-thumbnail img` (harmless, hidden behind player).

#### `yt.general.disableHoverPreview`

- `ytd-app #video-preview` — **[live]** · live: present in 18/18 snapshots (every page type) — host container of the inline preview player (always present, empty until hover)
- `ytd-video-preview` — **[live]** · live: present in 18/18 snapshots (every page type) — the preview element itself (inside ytd-video-preview-loader)
- `ytd-video-preview-loader` — **[live]** · live: present in 18/18 snapshots (every page type)
- `ytd-thumbnail-overlay-loading-preview-renderer` — **[source: RYS]** — legacy "loading" overlay while the preview starts
- `#mouseover-overlay` — **[live]** · live: present in 18/18 snapshots (every page type) — legacy thumbnail overlay (RYS hides it as "mouseover effect"); contains the "Play/Watch later/Add to queue" quick buttons
- `thumbnail-hover-overlay-view-model` — **[live]** · live: playlist 2 — new lockup hover overlay (quick-action buttons + preview trigger)

CSS only hides the preview; YouTube still *starts* loading/playing the muted preview off-screen (network + CPU). For a real stop the JS feature `thumbnails-hover.js` should also swallow the hover trigger: capture `mouseover`/`pointerenter` on `yt-lockup-view-model`, `ytd-thumbnail` and call `stopImmediatePropagation()` (needs live verification in Phase 3b; could not be tested here because no playback is possible in the sandbox). `ytd-video-preview` DOM only appears while hovering.

#### `yt.general.hideViewCounts`

- `yt-lockup-view-model .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > :nth-child(1 of .ytContentMetadataViewModelMetadataText)` — **[live]** · live: playlist 54, channel-videos 30, watch-music 26, +4 more snapshots — first text span of the "views • date" row (the channel row has no delimiter; the badge row has none)
- `yt-lockup-view-model .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > .ytContentMetadataViewModelDelimiter` — **[live]** · live: playlist 54, channel-videos 30, watch-music 26, +4 more snapshots — the bullet between views and date (hide with views so no dangling bullet)
- `yt-lockup-view-model .ytContentMetadataViewModelLeadingIcon` — **[live]** · live: playlist 54, channel-videos 30, watch-music 25, +4 more snapshots — "play triangle" icon before the views (watch sidebar / channel home layouts)
- `ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(1)` — **[live]** · live: hashtag 36, search-lofi 21, search-mrbeast 20, +2 more snapshots — legacy search result renderer: 1st span = views, 2nd = date
- `.shortsLockupViewModelHostOutsideMetadataSubhead` — **[live]** · live: channel-shorts 45, search-lofi 20, search-rice 20, +1 more snapshots — Shorts cards: the subhead is the view count only
- `ytd-playlist-video-renderer #video-info > span:nth-of-type(1)` — **[source: author knowledge]** — legacy playlist rows (no longer used on /playlist as of 2026-10: lockups)
- `ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(1)` — **[live]** · live: hashtag 36 — legacy rich-grid card (`ytd-rich-item-renderer > #content > ytd-rich-grid-media`) — still live on /hashtag/…
- `ytd-compact-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)` — **[source: author knowledge]** — legacy watch sidebar (0 matches 2026-10; replaced by lockups)
- `ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)` — **[source: RYS]** — legacy grid (subscriptions)

Live streams show "N watching" in the same slot (also hidden: that is a metric too). Rows that contain only views (no date) have no delimiter and are NOT matched by the `:has(> delimiter)` guard — acceptable leak. Uses `:nth-child(1 of S)` (Chromium 111+, Firefox 113+; fine for FF140). The watch page main view count is a separate setting (`yt.watch.hideViewCount`).

#### `yt.general.hideUploadDates`

- `yt-lockup-view-model .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > .ytContentMetadataViewModelMetadataText.ytContentMetadataViewModelMetadataTextLastPart` — **[live]** · live: playlist 54, channel-videos 30, watch-music 26, +4 more snapshots — last text span of the "views • date" row
- `yt-lockup-view-model .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > .ytContentMetadataViewModelDelimiter` — **[live]** · live: playlist 54, channel-videos 30, watch-music 26, +4 more snapshots — bullet (shared with hideViewCounts)
- `ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)` — **[live]** · live: hashtag 36, search-mrbeast 20, search-lofi 18, +2 more snapshots — legacy search results
- `ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(2)` — **[live]** · live: hashtag 36 — legacy rich-grid card (live on /hashtag/…)
- `ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(2)` — **[source: RYS]** — legacy grid

On Shorts cards there is no date. If a row has only a date (rare) it will not match the `:has(> delimiter)` guard. On the watch page the date is `ytd-watch-info-text #date-text` — covered by `yt.watch.hideViewCount`/description settings, not here.

#### `yt.general.hideDurations`

- `yt-thumbnail-bottom-overlay-view-model yt-thumbnail-badge-view-model` — **[live]** · live: playlist 54, channel-videos 30, watch-chapters 26, +5 more snapshots — duration pill (also LIVE/other bottom-right badges: acceptable)
- `ytd-thumbnail-overlay-time-status-renderer` — **[live]** · live: hashtag 72, watch-playlist 54, search-mrbeast 20, +3 more snapshots — legacy duration/LIVE/SHORTS overlay (search results)
- `yt-thumbnail-overlay-badge-view-model` — **[live]** · live: watch-playlist 4, watch-live 2, watch-music 2 — secondary overlay badges (e.g. playlist video count / Mix label)

The same `yt-thumbnail-bottom-overlay-view-model` hosts the *progress bar* (`yt-thumbnail-overlay-progress-bar-view-model`), so hide the badge child, not the host (see hideWatchedProgress).

#### `yt.general.hideChannelAvatars`

- `yt-lockup-view-model .ytLockupMetadataViewModelAvatar` — **[live]** · live: playlist 54, watch-chapters 26, watch-live 26, +3 more snapshots — avatar column in lockups (home grid, watch sidebar, playlist)
- `ytd-video-renderer #channel-info > a#channel-thumbnail` — **[live]** · live: search-lofi 21, search-mrbeast 20, search-rice 15 — avatar in search result rows
- `ytd-video-renderer #channel-info > #avatar` — **[live-structure]** · live: search-lofi 21, search-mrbeast 20, search-rice 15 — alt avatar slot in same row
- `ytd-rich-grid-media #avatar-container` — **[live]** · live: hashtag 36 — legacy rich-grid card (live on /hashtag/…)

Lab: on search results the channel name moves left with no indent hole (screenshot `lab-search-durations-badges-avatars.png`); on channel Home the lockup block shrinks 36 px (`#primary` 1497 -> 1461) — no gap. In lockups the avatar column has its own wrapper, so the text container takes the full width.

#### `yt.general.hideBadges`

- `yt-lockup-view-model .ytContentMetadataViewModelBadge` — **[live]** · live: channel-home 12, watch-music 3, watch-playlist 2 — CC / 4K / New / Live / Premiere chips in the 3rd metadata row
- `yt-lockup-view-model .ytContentMetadataViewModelIcon` — **[live]** · live: playlist 54, watch-playlist 19, watch-chapters 8, +3 more snapshots — trailing verified/artist icon after the channel name
- `ytd-video-renderer ytd-badge-supported-renderer` — **[live]** · live: search-lofi 123, search-mrbeast 120, search-rice 90 — legacy chips + verified check (search results)
- `ytd-video-renderer yt-badge-supported-renderer` — **[live]** · live: search-lofi 123, search-mrbeast 120, search-rice 90
- `ytd-video-renderer #badges` — **[live]** · live: search-lofi 21, search-mrbeast 20, search-rice 15
- `ytd-video-renderer ytd-channel-name ytd-badge-supported-renderer` — **[live]** · live: search-lofi 42, search-mrbeast 40, search-rice 30 — verified check next to channel names
- `yt-lockup-view-model yt-badge-view-model` — **[live]** · live: channel-home 12, watch-music 3, watch-playlist 2 — badge-shape host in view-model rows

Does NOT touch the duration pill (that is `yt-thumbnail-badge-view-model`, a different tag) nor the LIVE pill on the thumbnail. "Verified" also appears in the watch-page owner row and channel header (different components, see watch/channel settings).

#### `yt.general.hideWatchedProgress`

- `yt-thumbnail-overlay-progress-bar-view-model` — **[live]** · live: search-rice 2 — new resume bar (inside yt-thumbnail-bottom-overlay-view-model)
- `ytw-thumbnail-overlay-resume-playback-renderer` — **[live]** · live: search-rice 1 — resume bar in legacy ytd-thumbnail overlays — NOTE new `ytw-` prefix, no longer `ytd-`
- `ytd-thumbnail-overlay-resume-playback-renderer` — **[source: yt-neuter]** — older name (kept for A/B variants)

Matched live on search results ("how to cook rice"), where YouTube showed resume bars for 2 results. The tag prefix migration `ytd-*` -> `ytw-*` means every legacy selector may silently stop matching; always list both.

#### `yt.general.hideAds`

- `ytd-ad-slot-renderer` — **[source: easylist]** — generic ad slot (home grid, search, watch sidebar)
- `ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)` — **[source: easylist]** — ad as a rich-grid item (hides the empty card)
- `ytd-in-feed-ad-layout-renderer` — **[source: author knowledge]**
- `ytd-promoted-sparkles-web-renderer` — **[source: author knowledge]**
- `ytd-promoted-video-renderer` — **[source: author knowledge]**
- `ytd-display-ad-renderer` — **[source: RYS]**
- `ytd-carousel-ad-renderer` — **[source: RYS]**
- `ytd-action-companion-ad-renderer` — **[source: RYS]**
- `ytd-search-pyv-renderer` — **[source: RYS]**
- `ytd-compact-promoted-item-renderer` — **[source: AdGuard]**
- `ytd-banner-promo-renderer` — **[source: author knowledge]**
- `#masthead-ad` — **[live]** · live: channel-shorts 2, channel-videos 2, hashtag 2, +8 more snapshots
- `#player-ads` — **[live]** · live: present in 18/18 snapshots (every page type)
- `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots
- `#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)` — **[source: easylist]** — ads in the Shorts feed
- `.ytp-ad-module` — **[source: author knowledge]**
- `.video-ads` — **[source: author knowledge]**

Zero ads were served to the logged-out research browser, so the ad-tag selectors are all [source]; `#masthead-ad`, `#player-ads` and the ads panel exist as empty hosts. Never ship broad `[class*=ad]` style selectors.

#### `yt.general.hidePremiumUpsells`

- `ytd-mealbar-promo-renderer` — **[source: RYS]** — bottom "mealbar" promos
- `yt-mealbar-promo-renderer` — **[source: AdGuard]**
- `ytd-popup-container ytd-mealbar-promo-renderer` — **[source: AdGuard]**
- `ytd-popup-container > tp-yt-paper-dialog:has(upsell-view-model)` — **[source: yt-neuter]** — 2025 enhanced-bitrate nag
- `ytd-popup-container:has(> tp-yt-paper-dialog > ytd-offline-promo-renderer)` — **[source: yt-neuter]**
- `ytd-statement-banner-renderer` — **[source: AdGuard]**
- `ytd-banner-promo-renderer` — **[source: author knowledge]**
- `ytd-guide-entry-renderer:has(> a#endpoint[href="/premium"])` — **[source: yt-neuter]** — Premium guide link (logged in)
- `.ytp-quality-menu .ytp-menuitem:has(.ytp-premium-label)` — **[source: yt-neuter]** — "Premium" quality entries

None triggered logged-out. The surveys (`ytd-inline-survey-renderer`, `ytd-single-option-survey-renderer`, …) in yt-neuter belong to a different theme ("nags") — optional bonus toggle.

#### `yt.general.hideMixes`

- `yt-lockup-view-model:has(yt-collection-thumbnail-view-model):has(a[href*="list=RD"])` — **[live-structure]** — Mix = a *collection* lockup whose link has `list=RD…`. Seen on the first (re-parsed) Rick Astley dump: `/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1&rv=…`. NOTE: plain videos in "music" contexts also carry `&list=RD…&start_radio=1` hrefs (21 of 26 sidebar lockups on the exact lofi/music snapshots, nearly all on the Rick page), so the collection-thumbnail guard is essential. The exact snapshots contain only a "STATION" collection card (`watch-music`, no list param) and a real playlist (`watch-playlist`) (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)
- `yt-lockup-view-model:has(.ytLockupViewModelCollectionStack2):has(a[href*="list=RD"])` — **[live-structure]** — alternative using the stack class
- `ytd-compact-radio-renderer` — **[source: yt-neuter]** — legacy sidebar mix
- `ytd-radio-renderer` — **[source: yt-neuter]** — legacy search mix
- `ytd-rich-item-renderer:has(ytd-thumbnail-overlay-bottom-panel-renderer)` — **[source: yt-neuter]** — legacy home mix (disabled in neuter, issue #102: also matches playlists)

Playlists use `list=PL…`, Mixes `list=RD…` (the `RDMM` personal mix, `RDGM` genre mixes). Whole-card hiding, no hole: the card sits in `#contents` of an item section.

#### `yt.general.hidePlayables` — page: `home`

- `ytd-rich-shelf-renderer:has(a[href="/playables"])` — **[source: yt-neuter]**
- `ytd-rich-section-renderer:has(ytd-mini-game-card-view-model)` — **[source: RYS]**
- `ytd-rich-shelf-renderer[has-rounded-box-art-thumbnail-style]` — **[source: yt-neuter]**
- `ytd-mini-game-card-view-model` — **[source: RYS]**

Home-grid shelf; unverified live (no home cards).

#### `yt.general.hideWatched`

- `ytd-rich-item-renderer:has(yt-thumbnail-overlay-progress-bar-view-model)` — **[live-structure]** — home/channel grid card with a resume bar
- `ytd-rich-item-renderer:has(ytw-thumbnail-overlay-resume-playback-renderer)` — **[live-structure]**
- `yt-lockup-view-model:has(yt-thumbnail-overlay-progress-bar-view-model)` — **[live-structure]** — new lockups: the bar element is verified live (inside ytd-video-renderer thumbnails on search), a lockup with a bar was not in the sample
- `ytd-video-renderer:has(ytw-thumbnail-overlay-resume-playback-renderer)` — **[live]** · live: search-rice 1 — search results (2 live matches)
- `ytd-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model)` — **[live]** · live: search-rice 2
- `ytd-thumbnail:has(ytd-thumbnail-overlay-resume-playback-renderer)` — **[source: yt-neuter]** — legacy

The card wrapper must be the thing hidden (`ytd-rich-item-renderer`, `ytd-video-renderer`, `yt-lockup-view-model` inside a wrapper `div`), otherwise a hole remains in the grid. On /feed/history watched videos are the content — scope out `history`.

#### `yt.general.calmTitles`

- `yt-lockup-view-model .ytLockupMetadataViewModelTitle` — **[live]** · live: playlist 54, channel-videos 30, watch-chapters 26, +4 more snapshots — title anchor (text in `span.ytAttributedStringHost`)
- `ytd-video-renderer a#video-title` — **[live]** · live: search-lofi 21, search-mrbeast 20, search-rice 15 — search results
- `.shortsLockupViewModelHostMetadataTitle a` — **[live]** · live: channel-shorts 45, search-lofi 20, search-rice 20, +1 more snapshots — Shorts cards
- `ytd-watch-metadata #title h1 yt-formatted-string` — **[live]** · live: present in 18/18 snapshots (every page type) — watch page title

JS feature. Mind `aria-label` on the same anchors (full title + duration + views) — leave untouched (a11y). Text lives in a nested `span`; mutate `textContent` of that span only.

#### `yt.general.hideLiveBadgesAndPremieres`

- `yt-lockup-view-model badge-shape.ytBadgeShapeThumbnailLive` — **[live]** · live: watch-chapters 5, watch-live 5, watch-music 1 — the red LIVE pill on lockup thumbnails (language-free class; `div.ytBadgeShapeText` says "LIVE" localized)
- `yt-thumbnail-badge-view-model:has(> badge-shape.ytBadgeShapeThumbnailLive)` — **[live]** · live: watch-chapters 5, watch-live 5, watch-music 1 — its wrapper
- `ytd-video-renderer badge-shape.ytBadgeShapeLive` — **[live]** · live: search-lofi 3 — LIVE chip in search results (`#badges`); the thumbnail-overlay variant is `ytBadgeShapeThumbnailLive`
- `ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"]` — **[source: RYS]** — legacy overlay
- `ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"]` — **[source: RYS]** — legacy upcoming/premiere overlay

RECOMMEND DROPPING from v1: hiding the badge does not hide the livestream, and a duration-less live card looks broken; "Premiere"/"Upcoming" badge classes were not observable (no such cards in the logged-out sample).

### Top bar (masthead)

#### `yt.masthead.hideCreate`

- `#buttons.ytd-masthead:has(> ytd-notification-topbar-button-renderer) > :first-child` — **[inferred]** — structure only (language-free): logged-in order is [Create][bell][avatar]; the :has() guard prevents matching in the logged-out DOM (Settings + Sign in only). UNVERIFIED — needs a logged-in check
- `ytd-topbar-menu-button-renderer:has(button[aria-label=Create])` — **[source: yt-neuter]** — TEXT-BASED (English only) — violates PLAN §6.2 rule 2; documented for cross-checking
- `ytd-button-renderer:has(button[aria-label=Create])` — **[source: yt-neuter]** — TEXT-BASED; the 2024+ pill variant

Logged-in only. Logged out, `#buttons` contains: Settings (3-dot) `ytd-topbar-menu-button-renderer` and the Sign-in `ytd-button-renderer` — so a naive `#buttons > ytd-button-renderer` would hide "Sign in". Recommend verifying the structural selector once logged in via `npm run selectors`; fallback is the picker.

#### `yt.masthead.hideNotifications`

- `ytd-masthead ytd-notification-topbar-button-renderer` — **[source: RYS]** — logged-in only (bell + count badge)
- `ytd-masthead #buttons ytd-notification-topbar-button-renderer` — **[source: RYS]**

Logged-in only; not present in the logged-out DOM (0 matches).

#### `yt.masthead.hideVoiceSearch`

- `ytd-masthead #voice-search-button` — **[live]** · live: present in 18/18 snapshots (every page type) — mic button right of the search box (`div#voice-search-button`)
- `#voice-search-button` — **[source: yt-neuter]** · also matches live: present in 18/18 snapshots (every page type)

Lab (home): hiding it leaves the search box and sign-in button where they were (the box does not stretch). yt-neuter additionally blocks the voice-search sound files (`/s/search/audio/*.mp3`) at network level — irrelevant once the button is hidden.

#### `yt.masthead.hideSearchSuggestions`

- `yt-searchbox .ytSearchboxComponentSuggestionsContainer` — **[live]** · live: present in 18/18 snapshots (every page type) — the dropdown listbox (`role=listbox`, `hidden="true"` when closed; rows are `.ytSuggestionComponentSuggestion` / `[role=option]`)
- `yt-searchbox .ytSuggestionComponentSuggestion` — **[live-structure]** — individual rows (observed live after typing; the page is cleared on Esc)
- `div.sbdd_a` — **[source: RYS]** — legacy autocomplete (pre-yt-searchbox); 0 matches today
- `.sbdd_b` — **[source: author knowledge]** — legacy

CSS-only hiding leaves the keyboard handlers alive: ArrowDown still cycles through the (invisible) rows and rewrites the input value, and Enter submits the highlighted suggestion. If that is unacceptable the feature needs JS (e.g. capture `keydown` ArrowUp/Down on `yt-searchbox` and `preventDefault`). Observed live 2026-10-04: 14 rows for "lofi" plus a "Report search predictions" footer inside the same container.

#### `yt.masthead.hideSearchBar`

- `ytd-masthead #center` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#center.ytd-masthead` contains yt-searchbox + voice + (hidden) AI companion button
- `ytd-masthead yt-searchbox` — **[live]** · live: present in 18/18 snapshots (every page type)
- `ytd-masthead #search-button-narrow` — **[live]** · live: present in 18/18 snapshots (every page type) — the magnifier shown in narrow layouts

Hiding `#center` also removes the voice and AI buttons (they live inside it). Typing in the (hidden) search box is no longer possible; the `/` hotkey then focuses an invisible input — say so in the setting description. Search remains reachable through `/results?search_query=…` URLs.

#### `yt.masthead.hideCountryCode`

- `ytd-topbar-logo-renderer #country-code` — **[live]** · live: present in 18/18 snapshots (every page type) — `span#country-code` next to the logo (empty in US)
- `#country-code.ytd-topbar-logo-renderer` — **[live]** · live: present in 18/18 snapshots (every page type)

#### `yt.masthead.hideDoodle`

- `ytd-masthead ytd-yoodle-renderer` — **[live]** · live: present in 18/18 snapshots (every page type) — animated/seasonal logo ("yoodle"), `hidden` unless a doodle is active
- `#big-yoodle` — **[live]** · live: channel-shorts 1, channel-videos 1, hashtag 1, +3 more snapshots — big doodle slot at the top of the home grid (`div#big-yoodle.ytd-rich-grid-renderer`)

When a doodle is active YouTube hides the normal `ytd-logo` (via the `hidden` attribute) and shows `ytd-yoodle-renderer`. Hiding only the yoodle would leave NO logo. A complete implementation needs a second rule that un-hides the standard logo: `ytd-topbar-logo-renderer a#logo > div { display:block !important }` — not verifiable now (no doodle active today). Sources: yt-neuter (also blocks `gstatic.com/youtube/img/promos/*` images).

#### `yt.masthead.hideAICompanion`

- `ytd-masthead #ai-companion-button` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#ai-companion-button.ytd-masthead[hidden]` — exists (hidden) even logged out, so the selector is [live]; its contents appear only for eligible logged-in users

AI feature. The element sits inside `#center`, so `hideSearchBar` also removes it.

#### `yt.masthead.hideMastheadAd` — page: `home`

- `#masthead-ad` — **[live]** · live: channel-shorts 2, channel-videos 2, hashtag 2, +8 more snapshots — `div#masthead-ad` exists empty on ytd-browse AND inside ytd-rich-grid-renderer (home billboard ad slot)
- `ytd-banner-promo-renderer` — **[source: author knowledge]** — Premium promo banner
- `ytd-statement-banner-renderer` — **[source: AdGuard]** — brand "statement" banner
- `ytd-brand-video-singleton-renderer` — **[source: easylist]** — brand video on home
- `ytd-brand-video-shelf-renderer` — **[source: yt-neuter]**
- `ytd-primetime-promo-renderer` — **[source: easylist]**

Also covered by `yt.general.hideAds`. `#masthead-ad` is empty collapsed unless an ad is served — keep the rule (no layout side effect).

#### `yt.masthead.hideGuideButton`

- `ytd-masthead #guide-button` — **[live]** · live: present in 18/18 snapshots (every page type) — `yt-icon-button#guide-button.ytd-masthead` (the burger)

Without the burger the user cannot toggle the guide; combine with `yt.guide.hideAll` when that is the intention. The same id exists in the guide drawer header (`#header #guide-button`), scoped out by the `ytd-masthead` prefix.

### Left sidebar (guide)

#### `yt.guide.hideAll`

- `tp-yt-app-drawer#guide` — **[live]** · live: present in 18/18 snapshots (every page type) — full guide drawer
- `ytd-mini-guide-renderer` — **[live]** · live: present in 18/18 snapshots (every page type) — collapsed icon rail (exists, `hidden`, items lazily rendered)
- `ytd-masthead #guide-button` — **[live]** · live: present in 18/18 snapshots (every page type) — burger (RYS hides it together)

LAYOUT HOLE (verified in the CSS lab, 1440x900 home): hiding only the drawer leaves `ytd-page-manager` at x=240 — a 240 px blank gutter. Adding `ytd-app[guide-persistent-and-visible] ytd-page-manager.ytd-app { margin-left: 0 !important }` moves it to x=0, width 1440 (verified). On narrow viewports the equivalent attribute is `ytd-app[mini-guide-visible]` (page-manager x=72 -> 0, verified at 1100x800). Hiding the burger (`ytd-masthead #guide-button`) shifts the search box 20 px left (cosmetic).

#### `yt.guide.hideMini`

- `ytd-mini-guide-renderer` — **[live]** · live: present in 18/18 snapshots (every page type)
- `ytd-app[mini-guide-visible] ytd-page-manager` — **[live]** · live: home-narrow 1 — margin compensation target. VERIFIED (lab, 1100x800): with the mini guide hidden `ytd-page-manager` stays at x=72; adding `ytd-app[mini-guide-visible] ytd-page-manager.ytd-app { margin-left:0 !important }` moves it to x=0 (w 1100)

The mini guide is only visible when the full guide is collapsed (viewport < ~1312 px, or user toggled it). On the home page of a 1440 px viewport it is `hidden`.

#### `yt.guide.hideHome`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — primary entry; `a#endpoint[href="/"]`
- `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/"])` — **[live]** · live: home-narrow 1 — mini-guide twin (rendered only when the guide is collapsed, e.g. viewport < ~1312 px; verified at 1100x800: entries are Home, Shorts, Subscriptions, You)

Do NOT use `a[href="/"]` unscoped: the YouTube logo link in the masthead has the same href (RYS needed `a:not(#logo)[href="/"]`).

#### `yt.guide.hideShorts`

- `ytd-guide-entry-renderer[is-primary]:has(> a#endpoint:not([href]))` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — THE Shorts entry is the only primary entry WITHOUT an href in the logged-out guide (it navigates through a command endpoint). Language-free but structural — if YouTube ever adds an href this stops matching
- `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/shorts/"])` — **[live]** · live: home-narrow 1 — MINI guide: the Shorts entry HAS an href (`/shorts/`, verified at 1100x800) — language-free and the preferred selector there
- `ytd-guide-entry-renderer:has(> a#endpoint[href="/shorts/"])` — **[inferred]** — in case the full-guide entry ever gets the same href
- `ytd-guide-entry-renderer:has(> a#endpoint[title="Shorts"])` — **[source: gijsdev]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — TEXT-BASED (English `title`) — documented only; gijsdev/ublock-hide-yt-shorts 2026-04-29 still uses it
- `ytd-mini-guide-entry-renderer:has(a#endpoint[title="Shorts"])` — **[source: gijsdev]** · also matches live: home-narrow 1 — TEXT-BASED, mini guide
- `ytd-mini-guide-entry-renderer[aria-label="Shorts"]` — **[source: RYS]** — TEXT-BASED

Recommended robust alternative: the page-bridge (MAIN world) can read `ytd-guide-entry-renderer.data.icon.iconType` (VERIFIED live: `TAB_SHORTS_CAIRO`, vs `TAB_HOME_CAIRO`, `TAB_SUBSCRIPTIONS_CAIRO`, `ACCOUNT_CIRCLE_CAIRO`, `WATCH_HISTORY_CAIRO`; the Shorts entry has `serviceEndpoint` instead of `navigationEndpoint`) and the engine can tag the entry with `data-at-peace-entry="shorts"` (see Behaviour notes 4.7). VERIFIED in the CSS lab: the structural selector hides exactly the Shorts entry (Home/History selectors hide theirs; nothing else moves). The icon path (`d="m13.467 1.19-8 4.7a5 5 0 00-.255 8.46…"`) is a last-resort language-free key.

#### `yt.guide.hideSubscriptionsEntry`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/subscriptions"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots
- `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/subscriptions"])` — **[live]** · live: home-narrow 1 — mini guide
- `a#endpoint[href="/feed/subscriptions"]` — **[source: RYS]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +11 more snapshots — broader RYS form (also matches the Subscriptions link elsewhere, e.g. inside the sign-in empty state?) — prefer the scoped entry selector

#### `yt.guide.hideYouEntry`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/you"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — primary "You" entry (logged out: links to /feed/you "Library" sign-in page)
- `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/you"])` — **[live]** · live: home-narrow 1 — mini guide
- `a#endpoint[href="/feed/library"]` — **[source: RYS]** — older href

Logged in, "You" becomes a collapsible section (`ytd-guide-collapsible-section-entry-renderer`) holding History/Playlists/Watch later/Liked… — verify structure when logged in.

#### `yt.guide.hideHistory`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/history"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots
- `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/history"])` — **[inferred]** — no History in the 4-entry logged-out mini guide

Logged out, History is a primary entry; logged in it sits under "You".

#### `yt.guide.hidePlaylists`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/playlists"])` — **[source: author knowledge]** — logged-in "Playlists" entry (unverified)

Logged-in only; unverified.

#### `yt.guide.hideYourVideos`

- `ytd-guide-entry-renderer:has(> a#endpoint[href^="https://studio.youtube.com/channel/"])` — **[source: author knowledge]** — "Your videos" links to YouTube Studio content page; the bare Studio link (More from YouTube) has no /channel/ path

Logged-in only; unverified. Alternative: `/feed/my_videos`? not confirmed.

#### `yt.guide.hideWatchLater`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/playlist?list=WL"])` — **[source: author knowledge]** — "Watch later"

Logged-in only; href form from general knowledge. Unverified.

#### `yt.guide.hideLiked`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/playlist?list=LL"])` — **[source: author knowledge]** — "Liked videos"

Logged-in only; unverified.

#### `yt.guide.hideDownloads`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/downloads"])` — **[source: author knowledge]**

Logged-in only; unverified.

#### `yt.guide.hideCourses`

- `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/courses"])` — **[source: author knowledge]** — "Your courses"

Logged-in only; unverified. Also "Your clips": `/feed/clips` (yt-neuter: `.ytd-guide-entry-renderer[href="/feed/clips"]`).

#### `yt.guide.hideSubscriptionsSection`

- `ytd-guide-section-renderer:has(> #items > ytd-guide-collapsible-entry-renderer a#endpoint[href^="/@"])` — **[inferred]** — logged-in channel list: entries link to /@handle (or /channel/UC… for handle-less channels). Unverified
- `ytd-guide-section-renderer.style-scope:nth-of-type(2)` — **[source: RYS]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — POSITIONAL (RYS assumes the logged-in layout 2025): fragile — logged out it matches the **Explore** section (live match), i.e. the wrong one

Logged-in only. Not present logged out (the sign-in promo `ytd-guide-signin-promo-renderer` takes its place — see hideSignInPromo).

#### `yt.guide.hideExploreSection`

- `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — the Explore section is the one containing the YouTube Music topic channel link
- `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC4R8DWoMoI7CAwX8_LjQHig"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — same section also has the Live topic channel
- `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UCkYQyvc_i9hXEo4xic9Hh2g"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — and Shopping (logged-out set: Shopping, Music, Live + Show more)
- `ytd-guide-section-renderer:has(a#endpoint[href="/feed/trending"])` — **[source: yt-neuter]** — Trending entry (removed from YouTube in 2025: /feed/trending now redirects to /)

The topic-channel ids (`UC-9-kyTW8ZkZNDHQJ6FgpwQ` = Music, `UC4R8DWoMoI7CAwX8_LjQHig` = Live, `UCkYQyvc_i9hXEo4xic9Hh2g` = Shopping) are YouTube-owned and stable for years, but are not a documented contract. yt-neuter's `ytd-guide-section-renderer:has(#guide-section-title:has-text(Explore))` is uBlock-only syntax and text-based. The collapsed "Show more" part (`ytd-guide-collapsible-entry-renderer #expandable-items`) belongs to the same section.

#### `yt.guide.hideMoreFromYouTube`

- `ytd-guide-section-renderer:has(a#endpoint[href*="youtubekids.com"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — section with YouTube Kids (logged-out also YouTube TV `tv.youtube.com`)
- `ytd-guide-section-renderer:has(a#endpoint[href*="tv.youtube.com"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots
- `ytd-guide-section-renderer:has(a#endpoint[href^="https://music.youtube.com"])` — **[source: author knowledge]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — YouTube Music link (logged in)
- `ytd-guide-section-renderer:has(a#endpoint[href="/premium"])` — **[source: yt-neuter]** — Premium link (logged in)

Note `ytd-guide-section-renderer:has(...)` removes the whole section incl. its title and separator.

#### `yt.guide.hideSettingsSection`

- `ytd-guide-section-renderer:has(a#endpoint[href="/reporthistory"])` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — logged out: this section is just "Report history"
- `ytd-guide-section-renderer:has(a#endpoint[href="/account"])` — **[source: author knowledge]** — logged-in "Settings" entry

Logged-in also has Help and Send feedback (buttons, no href) in the same section.

#### `yt.guide.hideFooter`

- `ytd-guide-renderer #footer` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — About / Press / Copyright / Terms… links + © line
- `#guide-renderer > div#footer` — **[source: RYS]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots

#### `yt.guide.hideSignInPromo`

- `ytd-guide-signin-promo-renderer` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +10 more snapshots — "Sign in to like videos, comment, and subscribe" box (logged out only)

Logged-out only.

### Home

#### `yt.home.feedMode` — page: `home`

- `ytd-browse[page-subtype="home"] #primary` — **[live]** · live: home-narrow 1, home 1 — whole feed column (`div#primary.ytd-two-column-browse-results-renderer`); use this for the "hide" mode so a JS placeholder can live elsewhere in `ytd-browse`
- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer` — **[live]** · live: home-narrow 1, home 1
- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents` — **[live]** · live: home-narrow 1, home 1 — item container: children are ytd-rich-item-renderer (cards), ytd-rich-section-renderer (shelves), ytd-continuation-item-renderer (infinite scroll spinner)
- `ytd-browse[page-subtype="home"]` — **[source: RYS]** · also matches live: home-narrow 1, home 1 — RYS hides the whole ytd-browse (removes room for a placeholder)

`hide` = CSS on `#primary` + a calm placeholder injected by JS as a sibling inside `ytd-browse[page-subtype="home"]` (inside `#primary` it would be hidden too). `subscriptions|watchLater|playlists|custom` are redirects (DNR on full loads; JS on SPA navigation via `yt-navigate-start`; the `detail.url` / `detail.endpoint.commandMetadata.webCommandMetadata.url` of that event carry the target; the JS feature must cancel/override by `location.replace`). The home page type is `ytd-browse[page-subtype="home"]` — the logo link is `a#logo[href="/"]`.

#### `yt.home.redirectUrl` — page: `home`

No selectors (text setting). Validation: same-origin YouTube path or https URL. DNR handles full loads; SPA navigations need the JS feature.

#### `yt.home.hideChips` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #header` — **[live-structure]** · live: home-narrow 1, home 1 — `div#header.ytd-rich-grid-renderer[hidden]` observed (empty state). On channel /videos the same slot hosts `chip-bar-view-model`; on a populated home it hosts the chip bar
- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #header chip-bar-view-model` — **[live-structure]** — new chip bar component observed live on channel /videos (Latest/Popular/Oldest)
- `ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer` — **[source: yt-neuter]** — legacy chip bar (`yt-chip-cloud-chip-renderer[chip-style=STYLE_HOME_FILTER]` inside)
- `ytd-browse[page-subtype="home"] yt-chip-cloud-renderer` — **[source: yt-neuter]** — legacy

SIDE EFFECT: the masthead has a translucent backdrop whose height depends on whether a chip bar exists — `ytd-app #frosted-glass.with-chipbar` and `ytd-masthead[frosted-glass-mode]` (`without-chipbar` observed on the empty home). yt-neuter compensates with `#frosted-glass.with-chipbar.ytd-app { height:56px !important }`. Not verified: the logged-out home has no chip bar, so the gap/backdrop behaviour after hiding it is untested (check `#frosted-glass` height in the CSS lab once logged in).

#### `yt.home.hideShortsShelf` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` — **[source: gijsdev]** — Shorts shelf wrapper (is-shorts attr). gijsdev/ublock-hide-yt-shorts 2026-04-29
- `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[is-shorts]` — **[source: gijsdev]**
- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)` — **[inferred]** — if the shelf attr disappears, key on the Shorts card tag (observed live in search/channel)
- `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)` — **[source: gijsdev]** — Shorts cards placed directly in the rich grid (`ytd-rich-item-renderer[rendered-from-rich-grid] ytm-shorts-lockup-view-model`)
- `ytd-browse[page-subtype="home"] ytd-reel-shelf-renderer` — **[source: gijsdev]** — legacy Shorts shelf
- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(a[href^="/shorts/"])` — **[inferred]** — href-based fallback
- `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` — **[source: RYS]** — LEGACY card variant: a Short as a normal `ytd-rich-grid-media` card with the SHORTS overlay (RYS `shortsBadgeSelector`). The identical card structure IS live on /hashtag/cooking (36 cards, Shorts among them), so the pattern is live-confirmed there
- `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(a#thumbnail[href^="/shorts/"])` — **[inferred]** — same legacy card, href-based

Home has no cards when logged out with no history, so none of these could be matched live on home; the CONTAINER `ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer` was observed live. Card tags `ytm-shorts-lockup-view-model(-v2)` verified live elsewhere (search shelves, /@x/shorts). RYS fails on the first search-shelf variant because it requires the `HasBottomButton` class; do not copy that.

#### `yt.home.hideNewsShelf` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(a[href="/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"])` — **[inferred]** — News topic channel id (the same one the guide "News" entry uses) — unverified; language-free

Unverified; the shelf is only served in some regions/times ("Breaking news", "Top news"). yt-neuter hides it with a TEXT-BASED uBlock rule (`ytd-rich-shelf-renderer:has(#title:has-text(Breaking news))`) — not usable here. Fallback: Hide other shelves.

#### `yt.home.hidePostsShelf` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])` — **[source: yt-neuter]** — community posts shelf (yt-neuter: `ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])`)
- `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])` — **[source: yt-neuter]**
- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-post-renderer, ytd-backstage-post-thread-renderer)` — **[inferred]**
- `ytd-item-section-renderer:has(a[href$="/posts"])` — **[source: yt-neuter]** · also matches live: channel-home 1 — channel-page variant listed in yt-neuter (mind: also matches the channel Home "Posts" section)

Unverified live (no home cards).

#### `yt.home.hideOtherShelves` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer` — **[live]** · live: home-narrow 1, home 1 — every non-card row in the home grid (shelves: Shorts, Posts, Playables, "Previously watched", news, movies, the logged-out feed nudge…). Observed live: the empty-state nudge is a ytd-rich-section-renderer
- `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[has-rounded-box-art-thumbnail-style]` — **[source: yt-neuter]** — games/playables shelf
- `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer:has(a[href="/playables"])` — **[source: yt-neuter]** — Playables
- `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-mini-game-card-view-model)` — **[source: RYS]** — Playables (RYS tags this with is_playable)
- `ytd-browse[page-subtype="home"] ytd-statement-banner-renderer` — **[source: yt-neuter]**
- `ytd-browse[page-subtype="home"] ytd-brand-video-shelf-renderer` — **[source: yt-neuter]**

This one selector (rich-section children of the grid) subsumes the others — it also hides the Shorts shelf and the logged-out "try searching" nudge. Keep the specific ones as separate settings (hideShortsShelf etc.).

#### `yt.home.hideFeedNudge` — page: `home`

- `ytd-feed-nudge-renderer` — **[live]** · live: home-narrow 1, home 1 — "Try searching to get started" card (`h2#title-container`, `#subtitle-container`)
- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer:has(> #content > ytd-feed-nudge-renderer)` — **[live]** · live: home-narrow 1, home 1 — the wrapper (avoids an empty section margin)
- `ytd-rich-item-renderer:has(> #content > ytd-feed-nudge-renderer)` — **[source: yt-neuter]** — variant: nudge as a grid item

Shown logged out with no history ("Try searching to get started / Start watching videos to help us build a feed…") and to logged-in users with watch history off ("Keep track of what you watch").

#### `yt.home.limitRows` — page: `home`

- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer[elements-per-row]` — **[live]** · live: home-narrow 1, home 1 — host attribute `elements-per-row="3"` observed; also CSS var `--ytd-rich-grid-items-per-row`
- `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer` — **[live-structure]** — cards (observed live on channel /videos: 30 per load)

NOT feasible as pure CSS: the column count is responsive (`--ytd-rich-grid-items-per-row`, 3–6) so `:nth-child(n+K)` cannot express "N rows". RYS solves it in JS (reads `getComputedStyle(grid).getPropertyValue("--ytd-rich-grid-items-per-row")`, tags the items beyond N rows). Recommend implementing as JS in `home-feed.js` (tag `data-at-peace-row-hidden`) or dropping it from v1.

### Video page

#### `yt.watch.hideRelated` — page: `watch`

- `ytd-watch-flexy #related` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#related` in `#secondary-inner`; contains `ytd-watch-next-secondary-results-renderer` (the list of `yt-lockup-view-model`s) and — on plain videos (watch-chapters, watch-music) — also `#player-ads`; on playlist and live pages `#player-ads` is a *sibling* of `#related` instead (watch-playlist, watch-live)
- `ytd-watch-next-secondary-results-renderer` — **[live]** · live: present in 18/18 snapshots (every page type)
- `#related.ytd-watch-flexy` — **[source: RYS]** · also matches live: present in 18/18 snapshots (every page type) — RYS form

Siblings of `#related` inside `#secondary-inner` that must stay visible: `ytd-playlist-panel-renderer#playlist` (playlist/queue panel), `#chat-container` (live chat), `#panels` (engagement panels: transcript, chapters…), `#donation-shelf`, `#inline-panels`. Verified in the live outline. LAYOUT (lab, 1440x900): with only `#related` hidden, `#secondary` keeps its 412 px column — the player stays at x=16, w=996 with a blank right gutter. Hiding `#secondary` itself makes YouTube re-flow to single column: player x=23 w=1394 h=784 (a big "cinema" player; `#columns{justify-content:center}` changed nothing). A safe rule that keeps playlist/chat intact: `ytd-watch-flexy:not([live-chat-present-and-expanded]):not(:has(#playlist:not([hidden]))) #secondary { display:none }` (attribute `live-chat-present-and-expanded` verified on the live-stream page; `ytd-playlist-panel-renderer#playlist` has `hidden` unless a playlist is playing — verified on both pages). Engagement panels (`#panels`: transcript, chapters) also live in `#secondary`, so such a rule would hide them too.

#### `yt.watch.hideRelatedShorts` — page: `watch`

- `#related ytd-reel-shelf-renderer` — **[source: gijsdev]** — legacy Shorts shelf in the sidebar
- `ytd-watch-next-secondary-results-renderer ytd-shelf-renderer` — **[source: yt-neuter]** — "shelves in watch-next recommendations (shorts shelf)"
- `#related grid-shelf-view-model:has(ytm-shorts-lockup-view-model)` — **[inferred]** — same Shorts shelf component as search (observed there)
- `#related yt-lockup-view-model:has(a.ytLockupViewModelContentImage[href^="/shorts/"])` — **[inferred]** — a Short rendered as a regular lockup (href /shorts/ID)
- `ytd-compact-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` — **[source: RYS]** — legacy compact renderer (0 matches live: replaced by lockups)

No Shorts appeared in the logged-out sidebar during the research, so none could be matched live.

#### `yt.watch.hideRelatedChips` — page: `watch`

- `#related yt-related-chip-cloud-renderer` — **[inferred]** — chip row above related (logged-in; tag name from memory)
- `#related yt-chip-cloud-renderer` — **[source: yt-neuter]** — yt-neuter: `yt-chip-cloud-renderer` under "recommendations categories"
- `#related chip-bar-view-model` — **[inferred]** — new chip bar component
- `ytd-watch-next-secondary-results-renderer yt-chip-cloud-chip-renderer` — **[source: RYS]** — RYS marks chips with [hide-chip]

Chips do not render logged out (0 matches live). NB `chip-bar-view-model` also appears in an engagement-panel header (`ytd-engagement-panel-title-header-renderer #subheader`) — hence the `#related` scope.

#### `yt.watch.hideLiveChat` — page: `watch`

- `ytd-watch-flexy #chat-container` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#chat-container` wrapper (contains a `dom-if#chat-template` until a live chat exists)
- `ytd-live-chat-frame#chat` — **[source: yt-neuter]** · also matches live: watch-chapters 1, watch-live 1 — the chat element itself (iframe inside)
- `ytd-watch-flexy #chat` — **[source: RYS]** · also matches live: watch-chapters 1, watch-live 1

The chat is an `iframe` (`/live_chat?…`) — it must not be loaded into by the content script (all_frames false). Hiding the container via CSS stops it showing but the iframe keeps running in the background (network). Live chat replay for premieres uses the same element.

#### `yt.watch.hidePlayerAds` — page: `watch`

- `#player-ads` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#player-ads.ytd-watch-flexy` (companion ad slot; inside `#related` on plain videos, a sibling of it on playlist/live pages)
- `ytd-watch-flexy ytd-action-companion-ad-renderer` — **[source: RYS]**
- `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — ads engagement panel (exists hidden on every watch page)
- `.video-ads` — **[source: author knowledge]** — in-player ad layer container
- `.ytp-ad-module` — **[source: author knowledge]**
- `.ytp-ad-overlay-container` — **[source: author knowledge]** — overlay (banner) ads
- `ytd-companion-slot-renderer` — **[source: author knowledge]**
- `ytd-in-feed-ad-layout-renderer` — **[source: easylist]**

CSS hides only the ad UI — an ad that is playing keeps playing (audio). Real ad handling (skip button clicking / speeding) is out of scope for At Peace v1; RYS does it in JS. Observed live: none of the in-player ad containers exist while no ad is playing (0 matches except `#player-ads` and the hidden ads panel).

#### `yt.watch.hideShoppingShelf` — page: `watch`

- `#shopping-timely-shelf` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#shopping-timely-shelf.attached-message` under the title row (exists empty)
- `ytd-merch-shelf-renderer` — **[source: easylist]** — merch shelf under the description
- `#merch-shelf` — **[live]** · live: present in 18/18 snapshots (every page type) — `dom-if#merch-shelf.ytd-watch-flexy` (template) and `div#merch-shelf` inside the structured description
- `#product-shelf` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — `dom-if#product-shelf.ytd-watch-metadata`
- `#shopping-description-shelf` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — `dom-if#shopping-description-shelf`
- `ytd-engagement-panel-section-list-renderer[target-id^="shopping_panel_for_entry_point"]` — **[source: yt-neuter]**
- `.ytp-suggested-action` — **[live]** · live: present in 18/18 snapshots (every page type) — player pill "products in this video" — keep in hidePlayerAds? it is player UI: hide here
- `yt-overlay-product-sticker` — **[source: easylist]**

`.ytp-suggested-action` is a generic "suggested action" pill (shopping, timely actions); the five instances in the DOM are `display:none` until triggered.

#### `yt.watch.hideTickets` — page: `watch`

- `#ticket-shelf` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#ticket-shelf.ytd-watch-flexy` and `div#ticket-shelf` in the structured description

#### `yt.watch.hideHashtags` — page: `watch`

- `ytd-watch-metadata a[href^="/hashtag/"]` — **[live]** · live: watch-music 6 — anchors in the description info line (`yt-formatted-string#info`) and in the description text
- `#super-title` — **[source: yt-neuter]** — "hashtags above the title" (legacy; 0 matches today)
- `ytd-watch-metadata #title ~ * a[href^="/hashtag/"]` — **[inferred]**

Hashtags are inline text links: hiding them leaves the surrounding spaces. In the description text they are hidden too (selector scoped to `ytd-watch-metadata`).

#### `yt.watch.hideOwnerAvatar` — page: `watch`

- `ytd-watch-metadata ytd-video-owner-renderer #avatar` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — `yt-img-shadow#avatar` inside the `a` that links to the channel
- `ytd-watch-metadata #owner #avatar-stack` — **[live]** · live: present in 18/18 snapshots (every page type) — collaboration avatar stack (hidden)

The channel name link stays. The anchor wrapping the avatar collapses to 0 width.

#### `yt.watch.hideSubscriberCount` — page: `watch`

- `ytd-watch-metadata #owner-sub-count` — **[live]** · live: present in 18/18 snapshots (every page type) — `yt-formatted-string#owner-sub-count` ("4.55M subscribers")
- `#owner-sub-count` — **[source: RYS]** · also matches live: present in 18/18 snapshots (every page type)

#### `yt.watch.hideJoinButton` — page: `watch`

- `ytd-watch-metadata #sponsor-button` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#sponsor-button` ("Join"), empty for channels without memberships
- `ytd-watch-metadata #purchase-button` — **[live]** · live: present in 18/18 snapshots (every page type) — free-trial / buy button (hidden)
- `#sponsor-button` — **[source: yt-neuter]** · also matches live: present in 18/18 snapshots (every page type)

#### `yt.watch.hideLikeCounts` — page: `watch`

- `ytd-watch-metadata like-button-view-model .ytSpecButtonShapeNextButtonTextContent` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — the count text inside the like button ("19M")
- `ytd-watch-metadata like-button-view-model .yt-spec-button-shape-next__button-text-content` — **[source: RYS]** — OLD class naming (RYS) — 0 matches in 2026-10 DOM, where classes are camelCase
- `ytd-watch-metadata dislike-button-view-model .ytSpecButtonShapeNextButtonTextContent` — **[live-structure]** — dislike count (hidden/absent today)

Must NOT hide the like button itself (that is `yt.watch.hideLikeButtons`). After the text is gone the pill shrinks to an icon. Class-name migration: BEM `yt-spec-button-shape-next__button-text-content` became camelCase `ytSpecButtonShapeNextButtonTextContent`; include both until the old one is verified dead everywhere.

#### `yt.watch.hideLikeButtons` — page: `watch`

- `ytd-watch-metadata segmented-like-dislike-button-view-model` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — like+dislike capsule
- `ytd-watch-metadata like-button-view-model` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots
- `ytd-watch-metadata dislike-button-view-model` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots
- `ytd-watch-metadata ytd-segmented-like-dislike-button-renderer` — **[source: author knowledge]** — legacy

The player also has a like button in the fullscreen quick-actions (`yt-player-quick-action-buttons like-button-view-model`) — scoped out by `ytd-watch-metadata`.

#### `yt.watch.hideShare` — page: `watch`

- `ytd-watch-metadata #top-level-buttons-computed > yt-button-view-model:has(path[d^="M10 3.158V7.51"])` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — Share (language-free, via the arrow icon path start) — FRAGILE to icon refreshes
- `ytd-watch-metadata #top-level-buttons-computed > segmented-like-dislike-button-view-model + yt-button-view-model` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — positional: the first plain button after the like capsule (observed = Share)
- `ytd-watch-metadata ytd-button-renderer:has(button[aria-label=Share])` — **[source: yt-neuter]** — TEXT-BASED
- `yt-button-view-model:has(>button-view-model> button[aria-label=Share])` — **[source: yt-neuter]** · also matches live: watch-chapters 2, watch-live 2, watch-music 2, +1 more snapshots — TEXT-BASED

No language-neutral attribute exists on the buttons (only localized `aria-label`/`title`). The position of Share is stable in practice (right after the like capsule), but other buttons (Clip, Thanks, Ask, Remix) can be inserted before/after. Re-verify the position selector per release via `npm run selectors`.

#### `yt.watch.hideDownload` — page: `watch`

- `ytd-watch-metadata ytd-download-button-renderer` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — tag-based and language-free; lives in `#flexible-item-buttons`

Only shown to Premium users / eligible videos; logged-out DOM still contains it (`aria-label="Download"`).

#### `yt.watch.hideClip` — page: `watch`

- `ytd-watch-metadata yt-button-view-model:has(path[d^="M8 7c0 .55-.45 1-1 1s-1-.45-1-1"])` — **[source: RYS]** — scissors icon path (RYS uses `path[d^="M8 7c0 .55-.45 1-1 1s-1-.45-1-1"]` to tag the clip button); icon-path based
- `ytd-watch-metadata #menu button[scissor_button]` — **[source: RYS]** — RYS-internal marker — only valid if the RYS script runs; ignore
- `yt-button-view-model:has(>button-view-model> button[aria-label=Clip])` — **[source: yt-neuter]** — TEXT-BASED

Clip is only offered on eligible videos (not on the sample videos). Unverified live; same overflow-menu entry exists in `ytd-menu-popup-renderer` (icon-path based as well).

#### `yt.watch.hideThanks` — page: `watch`

- `yt-button-view-model:has(>button-view-model> button[aria-label=Thanks])` — **[source: yt-neuter]** — TEXT-BASED (yt-neuter also has a ytd-button-renderer variant with a nested :has(), which is invalid CSS in browsers)

No language-free selector known; Thanks is offered only on monetised creators. GAP — see report.

#### `yt.watch.hideSave` — page: `watch`

- `ytd-watch-metadata #flexible-item-buttons > yt-button-view-model:has(path[d^="M19 2H5a2 2 0 00-2 2v16"])` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — Save to playlist (bookmark icon path start) — FRAGILE
- `ytd-watch-metadata #flexible-item-buttons > yt-button-view-model:last-of-type` — **[live-structure]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — positional: last plain button in the flexible group (observed = Save)
- `yt-button-view-model:has(>button-view-model> button[aria-label="Save to playlist"])` — **[source: yt-neuter]** · also matches live: watch-chapters 2, watch-live 2, watch-music 2, +1 more snapshots — TEXT-BASED

Same caveat as Share.

#### `yt.watch.hideAsk` — page: `watch`

- `ytd-engagement-panel-section-list-renderer[target-id*="ai"]` — **[inferred]** — GUESS — no source or live observation of the target-id

UNRESOLVED. The "Ask" (Gemini) button/panel was not present in the logged-out DOM and no public blocklist lists it. Needs a logged-in check. PLAN: use the picker/`customRules` until known.

#### `yt.watch.hideMoreActions` — page: `watch`

- `ytd-watch-metadata ytd-menu-renderer > yt-button-shape#button-shape` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — the "…" button (`#button-shape`), logged-out
- `ytd-watch-metadata ytd-menu-renderer > yt-icon-button#button` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — older icon-button variant (hidden attr)

The menu holds Report / Transcript / Clip / etc. Hiding it removes Report as well.

#### `yt.watch.hideViewCount` — page: `watch`

- `ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(1):has(~ span:nth-child(3))` — **[live]** · live: watch-chapters 1, watch-playlist 1 — THE visible view count of a normal video: `yt-formatted-string#info` holds `span`(views) `span`(space) `span`(date) `span`(space) then an optional `a`/`span` (hashtags, "Members first"). The `:has(~ span:nth-child(3))` guard avoids hiding the *date* on live streams, whose `#info` is `span`(date) `span` `a` (verified on watch-live: 3rd child is an `a`)
- `ytd-watch-metadata ytd-watch-info-text #view-count` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots — `div#view-count` — rolling-number element used for the live "N watching now" counter (digits are an animated column: `textContent` is garbage)
- `ytd-watch-metadata ytd-watch-info-text tp-yt-paper-tooltip` — **[live]** · live: watch-chapters 1, watch-live 1, watch-playlist 1 — hover tooltip with the exact count ("9,734,875 views • Premiered Oct 17…")

The date is `#info > span:nth-child(3)` and stays unless hidden separately — there is no PLAN setting for the watch-page date; consider a `yt.watch.hideUploadDate`. Verified on 3 watch pages (the original `#view-count`-only selector did NOT hide the visible views in the CSS lab: the compact line is `#info`). Also see `yt.general.hideViewCounts` for feed cards.

#### `yt.watch.hideDescription` — page: `watch`

- `ytd-watch-metadata #description` — **[live]** · live: watch-music 5, watch-chapters 3, watch-live 2, +1 more snapshots — `div#description.item` — the whole grey description box incl. info line, expander and structured extras
- `ytd-watch-metadata ytd-text-inline-expander` — **[live]** · live: watch-chapters 1, watch-live 1, watch-music 1, +1 more snapshots

Note `#description` alone matches 4 elements in the document (SVG `<g id="description">` icon definitions in `iron-iconset-svg`) — always scope with `ytd-watch-metadata`. `#comment-teaser` and other entry-point cards of `#bottom-row` (e.g. the "Live chat replay" teaser with an "Open panel" button, seen in the lab on a stream replay) are siblings and are NOT hidden. Lab: `#below` height only drops 8 px because the collapsed box is replaced by those siblings.

#### `yt.watch.hideAISummary` — page: `watch`

- `ytd-expandable-metadata-renderer:has(video-summary-content-view-model)` — **[live]** · live: search-rice 1 — AI summary row — LIVE in SEARCH RESULTS (see yt.search.hideAISummary); on watch pages the same renderer is expected in `#expandable-metadata` (not observed: empty container)
- `ytd-structured-description-content-renderer #video-summary` — **[live]** · live: watch-chapters 2, watch-live 2, watch-music 2, +2 more snapshots — `div#video-summary` container exists (empty) in the structured description
- `video-summary-content-view-model` — **[source: yt-neuter]** · also matches live: search-rice 1 — the AI summary body
- `#expandable-metadata:has(video-summary-content-view-model)` — **[source: yt-neuter]** · also matches live: search-rice 1
- `#video-summary` — **[source: yt-neuter]** · also matches live: watch-chapters 2, watch-live 2, watch-music 2, +2 more snapshots

AI feature. The summary body component was not present in the logged-out sample videos (container only).

#### `yt.watch.hideChapters` — page: `watch`

- `ytd-horizontal-card-list-renderer:has(ytd-macro-markers-list-item-renderer)` — **[live]** · live: search-lofi 8, search-rice 4, watch-chapters 2, +2 more snapshots — the "Chapters / View all" strip in the expanded description
- `ytd-macro-markers-list-renderer` — **[live]** · live: watch-chapters 1, watch-playlist 1 — chapter list inside the engagement panel
- `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"]` — **[live]** · live: watch-chapters 1 — chapters panel
- `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-auto-chapters"]` — **[source: author knowledge]** · also matches live: watch-playlist 1 — auto-generated chapters panel
- `ytd-expandable-metadata-renderer:not(:has(video-summary-content-view-model))` — **[live]** · live: search-lofi 8, search-rice 4, search-mrbeast 1 — search results: the "68 chapters" row. NOTE the same `ytd-expandable-metadata-renderer` component also renders the AI summary row (see yt.search.hideAISummary) — keep the `:not(:has(…))` guard so the two settings stay independent

In-player chapter title/segments: see `yt.player.hideChapterTitle`.

#### `yt.watch.hideDescriptionExtras` — page: `watch`

- `ytd-structured-description-content-renderer #items` — **[live]** · live: watch-chapters 6, watch-music 6, watch-playlist 6, +2 more snapshots — container of ALL extra cards (chapters strip, music, transcript, course/podcast, channel infocard with social buttons, "Video details" item-section, places…). The same block is rendered twice: in the description expander and in engagement panel `engagement-panel-structured-description`
- `ytd-horizontal-card-list-renderer:has(yt-video-attribute-view-model)` — **[live]** · live: watch-music 2 — "Music" card strip ("Music · 1 song"): language-free via the `yt-video-attribute-view-model` card; live on watch-music (also links to the Music topic channel `/channel/UC-9-kyTW8ZkZNDHQJ6Fg…`)
- `yt-video-attribute-view-model` — **[live]** · live: watch-music 2 — the music/attribute card itself
- `ytd-video-description-music-section-renderer` — **[source: yt-neuter]** — older "Music in this video" section tag (0 matches today)
- `ytd-video-description-transcript-section-renderer` — **[live]** · live: watch-music 2, watch-playlist 2 — transcript promo
- `ytd-video-description-course-section-renderer` — **[live]** · live: watch-chapters 2, watch-live 2 — course / podcast / "Explore the podcast"
- `ytd-video-description-infocards-section-renderer` — **[live]** · live: watch-chapters 2, watch-live 2, watch-music 2, +1 more snapshots — channel info card (large)
- `ytd-horizontal-card-list-renderer` — **[live]** · live: search-lofi 8, search-rice 4, watch-chapters 2, +3 more snapshots — card strips (chapters, music, places, products…)
- `ytd-metadata-row-container-renderer` — **[live]** · live: present in 18/18 snapshots (every page type) — game / music / people rows (`#always-shown`, `#collapsible`)
- `ytd-rich-metadata-row-renderer` — **[source: yt-neuter]**
- `ytd-structured-description-content-renderer #video-summary` — **[live]** · live: watch-chapters 2, watch-live 2, watch-music 2, +2 more snapshots

The whole `#items` container removes chapters too; if Chapters should be independently controllable keep `hideChapters` on the card list only. NOTE: the first selector sits inside `#description`, so it is moot when `hideDescription` is on.

#### `yt.watch.hideInfoPanels` — page: `watch`

- `ytd-watch-flexy #clarify-box` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#clarify-box.attached-message` (exists empty)
- `ytd-info-panel-container-renderer` — **[source: RYS]** — context box (e.g. "Climate change", "COVID-19")
- `ytd-clarification-renderer` — **[source: author knowledge]**
- `ytd-watch-flexy #limited-state` — **[live]** · live: present in 18/18 snapshots (every page type) — age/limited-state notice (`div#limited-state.attached-message`)

#### `yt.watch.hideFundraiser` — page: `watch`

- `#donation-shelf` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#donation-shelf.ytd-watch-flexy` (in `#secondary-inner`)
- `ytd-donation-shelf-renderer` — **[source: author knowledge]**

The red "Fundraiser" badge (`.badge[aria-label="Fundraiser"]` in yt-neuter) is text-based and not offered.

#### `yt.watch.hideAmbientMode` — page: `watch`

- `ytd-watch-flexy #cinematics-container` — **[live]** · live: present in 18/18 snapshots (every page type) — ambient/cinematic glow (`div#cinematics-container` > `div#cinematics`) behind the player
- `ytd-watch-flexy #cinematics` — **[live]** · live: present in 18/18 snapshots (every page type)
- `ytd-watch-flexy #cinematics-full-bleed-container` — **[live]** · live: present in 18/18 snapshots (every page type) — full-bleed (theater) variant
- `#cinematic-container.ytd-reel-video-renderer` — **[live]** · live: shorts 1 — Shorts glow (also `#shorts-cinematic-container`, `#cinematic-shorts-scrim`)
- `cinematic-container-view-model` — **[live]** · live: playlist 2 — playlist-page header glow component (observed on /playlist)

JS alternative: toggle "Ambient mode" in the player settings menu (RYS: `.ytp-menuitem-toggle-checkbox` on the 2nd checkbox row) — fragile; CSS hide is preferable. Plan says CSS.

#### `yt.watch.disableAutoplay` — page: `watch`

- `.ytp-autonav-toggle` — **[live]** · live: present in 18/18 snapshots (every page type) — `button.ytp-button.ytp-autonav-toggle` (tooltip id `ytp-autonav-toggle-button`, `aria-label="Autoplay is on/off"`)
- `.ytp-autonav-toggle .ytp-autonav-toggle-button[aria-checked]` — **[live]** · live: present in 18/18 snapshots (every page type) — STATE: inner `div.ytp-autonav-toggle-button[aria-checked="true|false"]` — observed `true` on every logged-out watch page
- `.ytp-autonav-toggle-button[aria-checked=true]` — **[source: RYS]** · also matches live: present in 18/18 snapshots (every page type) — RYS clicks it when `offsetParent` is non-null
- `.ytm-autonav-toggle-button-container[aria-pressed=true]` — **[source: RYS]** — m.youtube.com only

Two ways: (1) click `.ytp-autonav-toggle` when `aria-checked==="true"`; (2) `#movie_player.setAutonav(false)` (function exists — verified — but in the sandbox's errored player it returned undefined without flipping `aria-checked`; could not confirm in a healthy player). Prefer click + re-read state; the toggle is `display:none` while the player is in an error/unstarted state, `element.click()` still dispatches. The setting is stored server-side for signed-in users and in `localStorage`/cookie for others (not verified).

#### `yt.watch.noAutoStart` — page: `watch`

- `#movie_player` — **[live]** · live: present in 18/18 snapshots (every page type) — player root; API: `pauseVideo()`, `getPlayerState()` (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued)
- `.ytp-play-button` — **[live]** · live: present in 18/18 snapshots (every page type) — click to pause
- `video.html5-main-video` — **[live]** · live: present in 18/18 snapshots (every page type) — `video.pause()` also works

Needs live verification in Phase 3b: playback is impossible in the sandbox (googlevideo.com blocked + "Sign in to confirm you're not a bot" gate), so the pause-on-start timing could not be tested.

#### `yt.watch.autoTheater` — page: `watch`

- `.ytp-size-button` — **[live]** · live: present in 18/18 snapshots (every page type) — theater toggle (`data-title-no-tooltip="Theater mode"` — text, do not match). Clicking sets `ytd-watch-flexy[theater]` + `[full-bleed-player]` and cookie `wide=1`; clicking again removes them (`wide=0`)
- `ytd-watch-flexy[theater]` — **[live-structure]** — state attribute (absent in default view; appears after the click / with the `wide=1` cookie — observed in the interaction tests, not in the static snapshots)
- `ytd-watch-flexy[full-bleed-player]` — **[live-structure]** — also set in theater

VERIFIED live: click -> attributes `theater`, `full-bleed-player` appear, `document.cookie` gains `wide=1`, second click removes. VERIFIED: loading a watch page in a fresh context whose cookie jar already holds `wide=1` (domain `.youtube.com`, path `/`) opens it in theater mode straight away (`ytd-watch-flexy[theater]`, `[full-bleed-player]`; the size button then reads "Default view"). So `autoTheater` can be implemented by *setting the cookie* (`document.cookie` — it is not HttpOnly — or `cookies.set`) instead of clicking after every navigation; SPA navigations from a non-watch page into a watch page still need the click fallback.

#### `yt.watch.defaultSpeed` — page: `watch`

- `#movie_player` — **[live]** · live: present in 18/18 snapshots (every page type) — API `setPlaybackRate(n)` / `getPlaybackRate()` / `getAvailablePlaybackRates()` -> [0.25,0.5,0.75,1,1.25,1.5,1.75,2]
- `video.html5-main-video` — **[live]** · live: present in 18/18 snapshots (every page type) — `video.playbackRate` follows the API (verified: after `setPlaybackRate(1.5)` both read 1.5)

Re-apply on every `yt-navigate-finish` and when the video element is replaced (ads, next video). `defaultSpeed` values above 2 are not offered by the UI (the API accepts 2.0 max for normal videos).

#### `yt.watch.dismissStillWatching` — page: `watch`

- `ytd-popup-container` — **[live]** · live: present in 18/18 snapshots (every page type) — host of all popups/dialogs (always present)
- `ytd-popup-container yt-confirm-dialog-renderer` — **[source: author knowledge]** — the "Video paused. Continue watching?" dialog is a yt-confirm-dialog-renderer with `#confirm-button` — NOT reproduced here (needs ~30–60 min of playback)
- `yt-confirm-dialog-renderer #confirm-button` — **[source: author knowledge]**

Unverified: the idle timeout cannot be provoked in the sandbox. Strategy for Phase 3b: MutationObserver on `ytd-popup-container` for `yt-confirm-dialog-renderer`, click `#confirm-button button`; alternatively keep the "last active" timestamp fresh (YouTube checks activity; the global `window._lact` is the classic hook — see Behaviour notes for what was observed).

### Player

#### `yt.player.hideEndscreenCards`

- `.ytp-ce-element` — **[live-structure]** — creator end-screen elements (video/playlist/channel/subscribe cards). Live on the Rick Astley video: 4 elements (channel + videos), `display:none` until the last ~20 s (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)
- `#movie_player .ytp-ce-element` — **[live-structure]** — inside the player per the live `#movie_player.outerHTML` fragment (watch-rick.player-early.html); the full-page re-parsed dump mis-nests them, so only the class-only selector above has a recorded match
- `.ytp-ce-element.ytp-ce-element` — **[source: RYS]** — RYS doubles the class to beat inline specificity

Elements live inside the player (`#movie_player`, serialised live from `outerHTML`), absolutely positioned over the video, `display:none` until their timestamp. `.ytp-ce-covering-overlay`/`.ytp-ce-covering-image` are the video-card parts; `.ytp-ce-channel` / `.ytp-ce-subscribe`-style variants exist. The `ytp-ce-` prefix = "creator endscreen". Also API: `movie_player.setCreatorEndscreenVisibility(false)` / `setCreatorEndscreenHideButton` exist (verified as functions) but their effect could not be tested without playback.

#### `yt.player.hideEndscreenWall`

- `.html5-endscreen` — **[live-structure]** — legacy video wall container (`div.html5-endscreen.ytp-player-content.videowall-endscreen`, display:none until the video ends) (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)
- `.ytp-endscreen-content` — **[live-structure]** (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)
- `.ytp-fullscreen-grid` — **[live]** · live: present in 18/18 snapshots (every page type) — modern fullscreen/end grid (`.ytp-fullscreen-grid-stills-container > a.ytp-modern-videowall-still` x12)
- `.ytp-modern-videowall-still` — **[live]** · live: watch-chapters 12, watch-live 12, watch-music 12, +1 more snapshots
- `.ytp-fullscreen-grid-stills-container` — **[source: RYS]** · also matches live: present in 18/18 snapshots (every page type)
- `.ytp-autonav-endscreen-countdown-overlay` — **[live-structure]** — the "Up next in N" overlay that appears at the end when autoplay is on (contains `.ytp-autonav-endscreen-upnext-button`) (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)

The wall only appears after the video ends (cannot be observed live here: playback is impossible in the sandbox). Hiding the countdown overlay while autoplay is ON still lets autoplay navigate after the countdown — pair with `disableAutoplay`.

#### `yt.player.hideInfoCards`

- `.ytp-cards-button` — **[live]** · live: present in 18/18 snapshots (every page type) — the "i" button top-right (`.ytp-chrome-top-buttons`)
- `.ytp-cards-teaser` — **[live]** · live: present in 18/18 snapshots (every page type) — the teaser bubble
- `.ytp-ce-element.ytp-ce-element` — **[source: RYS]**

"Info cards" (iv-drawer) vs "end screens" (`.ytp-ce-element`): RYS hides both with remove_info_cards; At Peace separates them.

#### `yt.player.hidePauseOverlay`

- `.ytp-pause-overlay` — **[source: RYS]** — "More videos" suggestions shown when paused (embeds)
- `.ytp-pause-overlay-container` — **[source: author knowledge]**
- `.ytp-info-panel-preview` — **[source: yt-neuter]** — embed info panel

On www.youtube.com the pause overlay is embed-only; none present on watch pages (0 matches). Mostly moot for the main site.

#### `yt.player.hideWatermark`

- `.iv-branding` — **[live-structure]** — channel branding watermark (`.ytp-overlay-bottom-right .annotation-type-custom.iv-branding`) (class observed in the first Rick Astley dumps `watch-rick.html` / `.player-early.html` — re-parsed HTML, no exact snapshot; these nodes exist only on videos that have end screens and later captures of such videos were refused by Google)
- `.ytp-watermark` — **[source: author knowledge]** — YouTube logo watermark (embeds)

#### `yt.player.hidePaidPromotion`

- `.ytp-paid-content-overlay` — **[live]** · live: present in 18/18 snapshots (every page type) — the "Includes paid promotion" pill (top-left)
- `.YtmPaidContentOverlayHost` — **[source: easylist]**

Legal disclosure label; hiding it is a user choice, flag it as such in the UI description.

#### `yt.player.hideAutoplayToggle`

- `.ytp-autonav-toggle` — **[live]** · live: present in 18/18 snapshots (every page type) — `button.ytp-button.ytp-autonav-toggle[data-tooltip-target-id="ytp-autonav-toggle-button"]`
- `button.ytp-button[data-tooltip-target-id=ytp-autonav-toggle-button]` — **[source: yt-neuter]** · also matches live: present in 18/18 snapshots (every page type)

The JS feature `disableAutoplay` reads `.ytp-autonav-toggle-button[aria-checked]` (the inner div). Use `visibility:hidden`-style hiding or make sure the feature can still read the state; `display:none` removes layout but `element.click()` still works.

#### `yt.player.hideNextButton`

- `.ytp-next-button` — **[live]** · live: present in 18/18 snapshots (every page type) — `a.ytp-next-button.ytp-button` in `.ytp-left-controls` (has `ytp-playlist-ui` when in a playlist)
- `a.ytp-next-button` — **[source: RYS]** · also matches live: present in 18/18 snapshots (every page type)

Also the previous button `.ytp-prev-button` exists (not in the setting list).

#### `yt.player.hideMiniplayerButton`

- `.ytp-miniplayer-button` — **[source: author knowledge]** — class from knowledge — not rendered in the errored player of the sandbox (0 matches)
- `.ytp-miniplayer-button.ytp-button` — **[source: author knowledge]**

Unverified live. Also the `i` keyboard shortcut still opens the miniplayer (CSS cannot stop that).

#### `yt.player.hideCastButton`

- `.ytp-remote-button` — **[live]** · live: present in 18/18 snapshots (every page type) — cast / remote playback button

#### `yt.player.hideSubtitlesButton`

- `.ytp-subtitles-button` — **[live]** · live: present in 18/18 snapshots (every page type) — CC button

Keyboard `c` still toggles captions.

#### `yt.player.hideChapterTitle`

- `.ytp-chapter-container` — **[live]** · live: present in 18/18 snapshots (every page type) — chapter title area in the control bar (`.ytp-chapter-title`)
- `.ytp-chapter-title` — **[live]** · live: present in 18/18 snapshots (every page type)

When chapters exist the container shows "• Chapter name >"; `.ytp-chapter-container-disabled` marks videos without chapters (collapsed).

#### `yt.player.hideProgressPreviews`

- `.ytp-tooltip-image` — **[source: author knowledge]** · also matches live: present in 18/18 snapshots (every page type) — hover storyboard frame
- `.ytp-storyboard-framepreview` — **[live]** · live: present in 18/18 snapshots (every page type) — storyboard preview container (exists)
- `.ytp-tooltip-bg` — **[source: author knowledge]** · also matches live: present in 18/18 snapshots (every page type)
- `.ytp-tooltip-progress-bar-pill` — **[live]** · live: present in 18/18 snapshots (every page type) — timestamp/chapter pill above the scrubber

Advanced; cosmetic only. Hover-related, could not be exercised (no playback).

### Comments

#### `yt.comments.hideAll` — page: `watch`

- `ytd-comments#comments` — **[live]** · live: present in 18/18 snapshots (every page type) — the comments section under the video (`div.box > ytd-comments#comments`)
- `ytd-watch-flexy ytd-comments` — **[live]** · live: present in 18/18 snapshots (every page type)
- `#comment-teaser` — **[live]** · live: present in 18/18 snapshots (every page type) — the one-comment teaser inside the description area (narrow/collapsed layouts)
- `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` — **[live]** · live: shorts 1, watch-chapters 1, watch-music 1, +1 more snapshots — comments as an engagement panel (side panel; hidden by default; also the Shorts comments panel)
- `ytd-comments-header-renderer` — **[live]** · live: channel-posts 1, watch-chapters 1, watch-music 1, +1 more snapshots

Page scope: the same selectors cover Shorts (comments panel) — the plan says comments settings apply to watch + shorts + posts. Community-post pages (`/post/ID`) reuse `ytd-comments`. Hidden `#comments` does not stop the comment request from loading (lazy; network).

#### `yt.comments.hideTeaser` — page: `watch`

- `#comment-teaser` — **[live]** · live: present in 18/18 snapshots (every page type) — `div#comment-teaser.item.ytd-watch-metadata` — single featured comment shown in the description area

#### `yt.comments.hideCount` — page: `watch`

- `ytd-comments-header-renderer #count` — **[live]** · live: channel-posts 1, watch-chapters 1, watch-music 1, +1 more snapshots — `h2#count` ("2,458,147 Comments")
- `ytd-comments-header-renderer yt-formatted-string.count-text` — **[live]** · live: channel-posts 1, watch-chapters 1, watch-music 1, +1 more snapshots

The header row (sort menu + "Add a comment") stays.

#### `yt.comments.hideAvatars` — page: `watch`

- `ytd-comment-view-model #author-thumbnail` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — author avatar column in each comment (button + img)
- `ytd-comment-simplebox-renderer #author-thumbnail` — **[live]** · live: watch-chapters 1, watch-music 1, watch-playlist 1 — your avatar next to "Add a comment…"
- `ytd-comment-renderer #author-thumbnail` — **[source: RYS]** — legacy renderer (RYS: `#author-thumbnail`)
- `ytd-backstage-post-renderer #author-thumbnail` — **[live]** · live: channel-posts 10 — community posts

The thread line (`.threadline`) lives inside the avatar column for replies and disappears with it.

#### `yt.comments.hideLikeCounts` — page: `watch`

- `ytd-comment-engagement-bar #vote-count-middle` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — `span#vote-count-middle` ("323K")
- `ytd-backstage-post-renderer #vote-count-middle` — **[live]** · live: channel-posts 10 — community posts (channel /posts) use the same id for the post like count
- `#vote-count-middle.ytd-comment-action-buttons-renderer` — **[source: RYS]** · also matches live: channel-posts 10, channel-home 6 — legacy

The like/dislike buttons themselves (`#like-button`, `#dislike-button`) are siblings and stay.

#### `yt.comments.hideReplies` — page: `watch`

- `ytd-comment-thread-renderer #replies` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — collapsed reply threads ("N replies" toggle + list)
- `#replies.ytd-comment-thread-renderer` — **[source: RYS]** · also matches live: watch-chapters 20, watch-music 20, watch-playlist 20
- `ytd-comment-replies-renderer` — **[live]** · live: watch-music 17, watch-chapters 12, watch-playlist 4

The "Reply" button in the engagement bar (`#reply-button-end`) is separate.

#### `yt.comments.hideCreatorHearts` — page: `watch`

- `ytd-comment-engagement-bar #creator-heart` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — the heart given by the creator
- `ytd-creator-heart-renderer` — **[live]** · live: watch-playlist 3

### Search

#### `yt.search.hideShorts` — page: `search`

- `ytd-search grid-shelf-view-model:has(ytm-shorts-lockup-view-model)` — **[live]** · live: search-lofi 3, search-rice 3, search-mrbeast 1 — every Shorts shelf ("Shorts", "Latest Shorts from X", custom titles like "Rice Cooking Guide✨")
- `ytd-search grid-shelf-view-model:has(a[href^="/shorts/"])` — **[live]** · live: search-lofi 3, search-rice 3, search-mrbeast 1 — href fallback
- `ytd-search ytd-reel-shelf-renderer` — **[source: gijsdev]** — legacy shelf
- `ytd-search ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` — **[source: gijsdev]** · also matches live: search-mrbeast 12 — a Short listed as a normal result
- `ytd-search ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])` — **[live]** · live: search-mrbeast 12 — href-based
- `ytd-search ytd-item-section-renderer ytd-shelf-renderer:has(a[href^="/shorts/"])` — **[inferred]**

RYS only matches `grid-shelf-view-model.ytGridShelfViewModelHostHasBottomButton…` and therefore misses shelves without a "Show more" button — in the "how to cook rice" search 1 of 3 Shorts shelves has no bottom button. Do not copy the class condition.

#### `yt.search.hideShelves` — page: `search`

- `ytd-search ytd-shelf-renderer` — **[live]** · live: search-lofi 1, search-mrbeast 1 — result shelves: "Latest from X", "People also watched", "For you", "Previously watched", "Latest posts from X"
- `ytd-search ytd-horizontal-card-list-renderer` — **[source: yt-neuter]** · also matches live: search-lofi 8, search-rice 4, search-mrbeast 1 — e.g. "People also search for" (yt-neuter, currently commented out there)
- `ytd-search ytd-universal-watch-card-renderer` — **[source: yt-neuter]** — featured channel/movie big card
- `ytd-search ytd-radio-renderer` — **[source: yt-neuter]** — channel mix
- `ytd-search ytd-search-pyv-renderer` — **[source: RYS]** — promoted video

Does not include Shorts shelves (separate `grid-shelf-view-model`), nor the channel result (`ytd-channel-renderer`).

#### `yt.search.hideRelatedSearches` — page: `search`

- `ytd-search ytd-search-refinement-card-renderer` — **[inferred]** — "Searches related to X" cards
- `ytd-search ytd-horizontal-card-list-renderer` — **[source: yt-neuter]** · also matches live: search-lofi 8, search-rice 4, search-mrbeast 1

No "related searches" block appeared in 3 logged-out searches ("lofi", "how to cook rice", "mrbeast"); name from memory — unverified.

#### `yt.search.hideAds` — page: `search`

- `ytd-search ytd-ad-slot-renderer` — **[source: easylist]**
- `ytd-search ytd-search-pyv-renderer` — **[source: RYS]**
- `ytd-search ytd-promoted-sparkles-web-renderer` — **[source: author knowledge]**
- `ytd-search ytd-promoted-video-renderer` — **[source: author knowledge]**
- `ytd-item-section-renderer > .ytd-item-section-renderer > ytd-ad-slot-renderer` — **[source: easylist]** — exact easylist form

No ads were served to the logged-out research browser.

#### `yt.search.hideSnippets` — page: `search`

- `ytd-search ytd-video-renderer .metadata-snippet-container` — **[live]** · live: search-lofi 13, search-mrbeast 13, search-rice 5 — 2-line description snippet under each result
- `ytd-search ytd-video-renderer .metadata-snippet-container-one-line` — **[source: RYS]** · also matches live: search-rice 11, search-lofi 8, search-mrbeast 1
- `ytd-search ytd-video-renderer #description-text` — **[live]** · live: search-lofi 21, search-mrbeast 20, search-rice 15
- `ytd-search ytd-channel-renderer #description` — **[source: yt-neuter]** · also matches live: search-mrbeast 2, search-lofi 1 — channel result description

The "N chapters" row and badge row under the snippet are separate (`ytd-expandable-metadata-renderer` / `#badges`).

#### `yt.search.hideFilterChips` — page: `search`

- `ytd-search ytd-search-header-renderer #chip-bar` — **[live]** · live: search-lofi 1, search-mrbeast 1, search-rice 1 — chip row (All / Shorts / Videos / …)
- `ytd-search ytd-search-header-renderer yt-chip-cloud-renderer` — **[live]** · live: search-lofi 1, search-rice 1
- `ytd-search ytd-search-header-renderer #filter-button` — **[live]** · live: search-lofi 1, search-mrbeast 1, search-rice 1 — the "Filters" button

Lab: hiding `#chip-bar` alone does not change the header height (56 px): the row also hosts the Filters button. Hide the whole `ytd-search-header-renderer` to reclaim the row (Filters is lost).

#### `yt.search.hideAISummary` — page: `search`

- `ytd-search ytd-expandable-metadata-renderer:has(video-summary-content-view-model)` — **[live]** · live: search-rice 1 — AI summary row under a search result: collapsed title + label "Summary", expands to "AI-generated video summary" with an "AI can make mistakes" notice. Language-free via the `video-summary-content-view-model` body. LIVE: 1 of 16 results for "how to cook rice"
- `ytd-search ytd-video-renderer #expandable-metadata:has(video-summary-content-view-model)` — **[live]** · live: search-rice 1 — wrapper variant
- `video-summary-content-view-model` — **[live]** · live: search-rice 1 — the summary body itself (also what yt-neuter keys on for the watch page)

PROPOSED NEW SETTING (not in PLAN §6.3; tag `ai`): AI summaries are shown **inside search results** logged out — a PLAN gap, since the AI bulk toggle only knew masthead/watch-page AI features. `#expandable-metadata` is shared with the chapters row ("N chapters"), so `yt.watch.hideChapters` must use the `:not(:has(video-summary-content-view-model))` guard.

#### `yt.search.hideChannelResults` — page: `search`

- `ytd-search ytd-channel-renderer` — **[live]** · live: search-mrbeast 2, search-lofi 1 — channel cards inside results (big avatar + Subscribe)

Advanced. A channel that is the *only* intent of the query ("mrbeast") will lose its card.

### Shorts

#### `yt.shorts.hideComments` — page: `shorts`

- `ytd-shorts ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` — **[live]** · live: shorts 1 — comments panel (x3 in DOM)
- `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)` — **[live-structure]** · live: shorts 1 — comments button: first plain `button-view-model` in the action bar (like and dislike have their own tags). Positional
- `ytd-reel-player-overlay-renderer #comments-button` — **[source: author knowledge]** — legacy action bar

Action bar observed live: `reel-action-bar-view-model` > [`like-button-view-model`, `button-view-model` x3 (comments, share, remix), `pivot-button-view-model` (sound)].

#### `yt.shorts.hideLikeCounts` — page: `shorts`

- `ytd-shorts reel-action-bar-view-model like-button-view-model .ytSpecButtonShapeWithLabelLabel` — **[live]** · live: shorts 1 — the count under the heart ("842")
- `ytd-shorts reel-action-bar-view-model button-view-model:nth-of-type(1) .ytSpecButtonShapeWithLabelLabel` — **[live-structure]** · live: shorts 2 — the comments count under the comments button ("17")

#### `yt.shorts.hideRemix` — page: `shorts`

- `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(3)` — **[live-structure]** · live: shorts 1 — positional: 3rd plain button (Remix)
- `ytd-reel-player-overlay-renderer #remix-button` — **[source: author knowledge]**
- `ytd-shorts reel-action-bar-view-model > pivot-button-view-model` — **[live]** · live: shorts 1 — "sound" pivot (round avatar at the bottom) — related, not Remix

Positional (language-free) selector; unverified for the 3-vs-4 button variants (logged-in has a dislike button — its own tag).

#### `yt.shorts.hideSubscribe` — page: `shorts`

- `ytd-shorts yt-reel-channel-bar-view-model .ytReelChannelBarViewModelReelSubscribeButton` — **[live]** · live: shorts 1 — Subscribe button next to the @handle
- `ytd-reel-player-overlay-renderer #subscribe-button` — **[source: author knowledge]**

#### `yt.shorts.mode` — page: `shorts`

- `ytd-shorts` — **[live]** · live: shorts 1 — the Shorts player page element (`ytd-page-manager > ytd-shorts[role=main]`, no `page-subtype`); pageType in events: `shorts`
- `a[href^="/shorts/"]` — **[live]** · live: hashtag 99, channel-shorts 90, search-lofi 40, +3 more snapshots — every Shorts card/link in feeds, search shelves, channel Shorts tab (`a.shortsLockupViewModelHostEndpoint`), the Shorts shelf header
- `ytd-shorts #shorts-container` — **[live]** · live: shorts 1

`watch` mode: DNR rewrite `youtube.com/shorts/ID` -> `/watch?v=ID` for full loads (works: /watch plays a Short in the normal player); for SPA navigation, `yt-navigate-start` detail `{pageType:"shorts", url:"/shorts/ID"}` -> `location.replace("/watch?v=ID")` (observed `yt-navigate-*` events carry the url). Rewriting `href`s does not help: lockup anchors navigate through command endpoints, not the href. `block` mode: show a calm page instead of the player (do not touch ytd-shorts internals).

### Subscriptions

#### `yt.subs.hideShorts` — page: `subscriptions`

- `ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` — **[source: gijsdev]**
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)` — **[source: gijsdev]** — Shorts cards inside the subscriptions grid
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(a[href^="/shorts/"])` — **[inferred]** — href fallback
- `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` — **[source: RYS]** — legacy grid
- `ytd-browse[page-subtype="subscriptions"] ytd-reel-shelf-renderer` — **[source: gijsdev]**
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` — **[source: RYS]** — legacy card variant (`ytd-rich-grid-media`) — structure confirmed live on /hashtag/cooking

Page requires login — logged out it only shows the "Don't miss new videos / Sign in" promo (`ytd-background-promo-renderer` inside `ytd-item-section-renderer`). Entire catalogue here is [source]/[inferred].

#### `yt.subs.hidePosts` — page: `subscriptions`

- `ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])` — **[source: yt-neuter]**
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])` — **[source: yt-neuter]**
- `ytd-browse[page-subtype="subscriptions"] ytd-post-renderer` — **[source: author knowledge]**

Unverified.

#### `yt.subs.hideLive` — page: `subscriptions`

- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailLive)` — **[inferred]** — LIVE pill class observed live on lockups in the watch sidebar (`badge-shape.ytBadgeShapeThumbnailLive`; in search-result chips it is `ytBadgeShapeLive`)
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeLive)` — **[inferred]** — chip variant
- `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer[badge-text="live"]` — **[source: RYS]** — RYS-internal marker (set by the RYS script) — not a native attribute

The LIVE pill class is language-free and was verified on lockups (watch sidebar).

#### `yt.subs.hideUpcoming` — page: `subscriptions`

- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailUpcoming)` — **[inferred]** — class name GUESSED by analogy with ...ThumbnailLive
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"])` — **[source: RYS]** — legacy overlay-style attribute (RYS upcomingBadgeSelector)

Unverified; also Premieres (`overlay-style="PREMIERE"`?).

#### `yt.subs.hideWatched` — page: `subscriptions`

- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(yt-thumbnail-overlay-progress-bar-view-model)` — **[live-structure]** — card with a resume bar (bar element verified live in search results)
- `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytw-thumbnail-overlay-resume-playback-renderer)` — **[live-structure]**
- `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer)` — **[source: author knowledge]** — legacy

Only items with a resume bar (watched ≥ a few %). A fully-watched video also gets a full bar. Same approach for `yt.general.hideWatched`.

### Channel

#### `yt.channel.openVideosTab` — page: `channel`

- `yt-tab-shape[role="tab"]` — **[live]** · live: channel-home 5, channel-posts 5, channel-shorts 5, +2 more snapshots — tabs carry NO href; identity only via localized `tab-title` or page data. JS must use the URL (`/@x` -> `/@x/videos`) not the DOM

JS feature: on `yt-navigate-finish` when `pageType==="channel"` and the path has no tab segment, `location.replace(path + "/videos")` (or click the 2nd `yt-tab-shape`; position of Videos is stable but unverified for all channels). Channel home path forms observed: `/@MrBeast`, `/@MrBeast/videos`, `/shorts`, `/posts`, `/playlists`; handle-less channels `/channel/UC…`.

#### `yt.channel.hideTrailer` — page: `channel`

- `ytd-browse[page-subtype="channels"] ytd-channel-video-player-renderer` — **[live]** · live: channel-home 1 — featured video / trailer on the channel Home tab (autoplays)

CSS hides it, but the player may still load; JS `ytd-channel-video-player-renderer video.pause()` (RYS) if needed.

#### `yt.channel.hideHomeShelves` — page: `channel`

- `ytd-browse[page-subtype="channels"] ytd-item-section-renderer` — **[live]** · live: channel-home 5, channel-posts 1 — each Home-tab section (shelves of videos, channels, posts) is an item section (5 observed)
- `ytd-browse[page-subtype="channels"] ytd-shelf-renderer` — **[live]** · live: channel-home 4
- `ytd-browse[page-subtype="channels"] yt-horizontal-list-renderer` — **[live]** · live: channel-home 4 — the scrolling list inside shelves
- `*[is-channel-for-you-section]` — **[source: RYS]** — RYS-internal marker

The channel trailer (`ytd-channel-video-player-renderer`) lives inside the FIRST of these item sections, so this setting also removes it (lab: #primary height 1497 px -> 780 px with all sections hidden, 1497 -> 1211 with only the trailer hidden; no gaps). The same sections host content on other tabs (e.g. /posts = `ytd-backstage-items`). Page scope + tab check needed: the Home tab is the only tab where the URL has no tab segment — set `data-at-peace-channel-tab` in JS (`home|videos|shorts|live|playlists|posts|…`) so CSS can scope to home only.

#### `yt.channel.hideShortsTab` — page: `channel`

- `ytd-browse[page-subtype="channels"] yt-tab-shape[tab-title="Shorts"]` — **[source: gijsdev]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots — TEXT-BASED (English) — gijsdev/ublock-hide-yt-shorts
- `ytd-browse[page-subtype="channels"] yt-tab-shape:nth-of-type(3)` — **[inferred]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots — positional guess: Home, Videos, Shorts — varies per channel (Live, Podcasts…)

PROBLEM: tabs expose no language-free key in the DOM (`yt-tab-shape[role=tab][tab-title]`, no href) and `yt-tab-shape.data` is `null` in the MAIN world (tested). Candidate: read the channel page response from the page (`ytd-browse.data.contents.twoColumnBrowseResultsRenderer.tabs[].tabRenderer.endpoint.browseEndpoint.canonicalBaseUrl` — NOT verified) in the page-bridge and tag the tab by index (`data-at-peace-tab="shorts"`). Without it this setting is English-only. Observed tab set on MrBeast: Home, Videos, Shorts, Shows, Posts.

#### `yt.channel.hidePostsTab` — page: `channel`

- `ytd-browse[page-subtype="channels"] yt-tab-shape[tab-title="Posts"]` — **[source: yt-neuter]** · also matches live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots — TEXT-BASED (English; "Community" in older locales)

Same problem as Shorts tab. Older channels call it "Community".

#### `yt.channel.hideStoreTab` — page: `channel`

- `ytd-browse[page-subtype="channels"] yt-tab-shape[tab-title="Store"]` — **[source: yt-neuter]** — TEXT-BASED

Same problem. No Store tab on the sample channel.

#### `yt.channel.hideSubscriberCount` — page: `channel`

- `ytd-browse[page-subtype="channels"] .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > :nth-child(1 of .ytContentMetadataViewModelMetadataText)` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots — in the header metadata, the row with a bullet is "subscribers • videos": its first text is the subscriber count
- `ytd-browse[page-subtype="channels"] .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > .ytContentMetadataViewModelDelimiter` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots

Header metadata observed: [@handle] • [519M subscribers • 1K videos]. The first row (handle) has no inner delimiter. Hiding only the first text leaves "• 1K videos".

#### `yt.channel.hideBanner` — page: `channel`

- `ytd-browse[page-subtype="channels"] #page-header-banner` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots — `div#page-header-banner.ytd-tabbed-page-header` (banner image wrapper, `yt-image-banner-view-model`)
- `ytd-browse[page-subtype="channels"] yt-image-banner-view-model` — **[live]** · live: channel-home 1, channel-posts 1, channel-shorts 1, +1 more snapshots
- `.page-header-banner` — **[source: yt-neuter]**

Check that the avatar/title block below does not jump (page-header uses the banner as a background only).

### Filters

#### `yt.filters.keywords`

JS only. Element to hide, text to match and the MutationObserver root per surface are tabulated in §2.8 (cheat-sheet); text sources: `a#video-title[title]`, `a.ytLockupMetadataViewModelTitle`, `.metadata-snippet-text`, Shorts `.shortsLockupViewModelHostMetadataTitle a`.

#### `yt.filters.channels`

JS only; see §2.8. Channel keys differ per surface: search rows `ytd-channel-name a[href]` (`/@handle` **or** `/channel/UC…`), home/channel lockups `.ytContentMetadataViewModelMetadataText a[href]`, legacy cards `ytd-channel-name a`, **watch sidebar: name text only** (no link/handle), channel `/videos`: none (implicit), Shorts cards: none.

#### `yt.filters.commentKeywords` — page: `watch`

- `ytd-comment-thread-renderer` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — unit to hide: the thread (comment + replies)
- `ytd-comment-thread-renderer #content-text` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — text to match (`yt-attributed-string#content-text` > span)
- `ytd-comment-view-model #author-text` — **[live]** · live: watch-chapters 20, watch-music 20, watch-playlist 20 — author handle

Filtered threads get `data-at-peace-filtered` and are hidden by CSS. Comments load lazily and re-render when sorting: observe `ytd-comments` subtree.

#### `yt.filters.applyTo`

No selectors: page scopes only (home, search, watch sidebar, subscriptions). The card-anatomy section lists the item wrappers per surface.


---

## 4. Behaviour notes for JS features

### 4.1 SPA navigation events (verified live)

All four are `CustomEvent`s dispatched on **`document`** (they bubble; listening on `document` or `window` works).

| Event | When | `event.detail` (observed keys) |
|---|---|---|
| `yt-navigate-start` | SPA navigation begins (**not** fired on the initial full load) | `{ endpoint, pageType:"watch", url:"/watch?v=rFZHOHl-L8A", reload:false, noProgressBar:false }` — `url` is the **relative target URL**, `endpoint` the command object |
| `yt-navigate` | right after start, only for user clicks | `{ element, event, createScreenConfig, endpoint }` — `element` = the clicked node |
| `yt-navigate-finish` | navigation done, new page DOM is in place | `{ endpoint:{clickTrackingParams, commandMetadata:{webCommandMetadata:{url, webPageType:"WEB_PAGE_TYPE_WATCH", rootVe}}, watchEndpoint:{videoId, playerParams}}, pageType:"watch", fromHistory:false, response:{…big…}, navigationDoneMs }` |
| `yt-page-data-updated` | page data (re)rendered; also on initial load | `{ pageType:"watch" }` only |

* **Initial full load** fires `yt-navigate-finish` and `yt-page-data-updated` once each, **in either order** (watch: finish→updated; home/search/channel/feeds: updated→finish). No `yt-navigate-start`. The engine must therefore also run page detection once at `document_start`/`DOMContentLoaded` from `location`.
* `pageType` differs between the two events — `yt-page-data-updated.detail.pageType` is the finer one:

| URL | `yt-page-data-updated` `pageType` | `yt-navigate-finish` `pageType` / `webPageType` | Page element |
|---|---|---|---|
| `/` | `home` | `browse` / `WEB_PAGE_TYPE_BROWSE` | `ytd-browse[page-subtype="home"]` |
| `/watch?v=…` | `watch` | `watch` / `WEB_PAGE_TYPE_WATCH` | `ytd-watch-flexy`, `ytd-app[is-watch-page]` |
| `/results?search_query=…` | `search` | `search` / `WEB_PAGE_TYPE_SEARCH` | `ytd-search` |
| `/@handle`, `/@handle/videos`, `/shorts`, `/posts`, `/playlists` | `channel` | `channel` / `WEB_PAGE_TYPE_CHANNEL` | `ytd-browse[page-subtype="channels"]` |
| `/feed/subscriptions` | `subscriptions` | `browse` / `WEB_PAGE_TYPE_BROWSE` | `ytd-browse[page-subtype="subscriptions"]` |
| `/feed/history` | `history` | `browse` | `ytd-browse[page-subtype="history"]` |
| `/feed/you` | `you` | `browse` | `ytd-browse[page-subtype="you"]` |
| `/playlist?list=…` | `playlist` | `playlist` / `WEB_PAGE_TYPE_PLAYLIST` | `ytd-browse[page-subtype="playlist"]` |
| `/hashtag/x` | (events not captured) | — | `ytd-browse[page-subtype="hashtag-landing-page"]` |
| `/shorts/ID` | `shorts` | `shorts` (initial load; order updated→finish) | `ytd-shorts`, `ytd-app[is-shorts-page]` |
| `/feed/trending`, `/feed/explore` | `trending` / `explore` (transient), then the page redirects to `/` | `browse` for URL `/` | home |

* **Detect page type from the URL**, not the DOM (the old pages stay in the DOM). URL → type is exactly PLAN §6.1 (`/feed/trending` and `/feed/explore` now land on `home`). Use `yt-page-data-updated` only as a "DOM is ready" signal; `yt-navigate-start.detail.url` is the cheapest place to **redirect early** (home/shorts redirects, channel→`/videos`).
* Re-apply per-video state (speed, theater, autoplay toggle) on `yt-navigate-finish`; the player element is **reused** between watch pages (`#movie_player` keeps its identity).

### 4.2 Autoplay ("Up next") toggle

Element (live, `watch-chapters`): `div.ytp-chrome-controls > div.ytp-right-controls > div.ytp-right-controls-left > button.ytp-button.ytp-autonav-toggle[data-tooltip-target-id="ytp-autonav-toggle-button"][data-tooltip-title="Autoplay is on"]`, inner state element `.ytp-autonav-toggle-button-container > div.ytp-autonav-toggle-button[aria-checked="true"|"false"]` (observed `true` on every logged-out watch page). Matches the PLAN's `.ytp-autonav-toggle-button[aria-checked]`.

* **DOM method — verified live:** clicking the **outer** `button.ytp-autonav-toggle` flipped the inner `aria-checked` `true → false`, and a second click restored `true` (1.2 s apart, in the errored player). RYS polls every ~½ s and clicks when `aria-checked=="true"`. `element.click()` works on `display:none` elements; the player hides the button in some states.
* **API method**: `#movie_player.setAutonav(false)` and `.setAutonavState(n)` exist (functions, verified) and return `undefined`. In the sandbox's gated player they did **not** flip `aria-checked`, so their real effect is **unverified**; there is **no `getAutonavState`** on the object (`undefined`). Recommended: click the toggle, then verify by re-reading `aria-checked`; call `setAutonav(false)` as a belt-and-braces second step.
* The end-of-video "Up next in N s" overlay is `.ytp-autonav-endscreen-countdown-overlay` (children: `.ytp-autonav-endscreen-countdown-container`, `.ytp-autonav-endscreen-upnext-button`, a cancel button); `#movie_player` gets class `ytp-autonav-endscreen-cancelled-state` in the *cancelled/unstarted* state (observed in the class list) and `ended-mode` when finished. Not observable live here.
* PLAN mismatch: none. Mobile variant is `.ytm-autonav-toggle-button-container[aria-pressed]` (irrelevant: desktop only).

### 4.3 Theater mode (verified live)

* Button: `button.ytp-size-button.ytp-button` (its tooltip `data-title-no-tooltip="Theater mode"` is localised — do not match).
* State: `ytd-watch-flexy[theater]` (+ `[full-bleed-player]`). **Click → both attributes appear and `document.cookie` gains `wide=1`; second click → attributes removed.** Initial state: absent.
* Auto-theater options: (a) on `yt-navigate-finish` when `pageType==="watch"` and `!flexy.hasAttribute("theater")` ⇒ click `.ytp-size-button` (RYS does exactly this); (b) pre-set the cookie `wide=1` before the page loads — **verified**: a fresh browser context whose jar contains `wide=1` (domain `.youtube.com`, path `/`) opened a watch page with `ytd-watch-flexy[theater]` and `[full-bleed-player]` already set (size button label "Default view"). Prefer (b) for full loads (set via `document.cookie`; the cookie is not HttpOnly) and keep (a) for SPA navigations from non-watch pages.

### 4.4 `#movie_player` API surface (MAIN world; verified by evaluating in the page)

`document.querySelector('#movie_player')` is the player root (`div#movie_player.html5-video-player`, inside `ytd-player#ytd-player > div#container`). **over 200 functions are exposed** (full list was dumped; the useful ones, all `typeof === 'function'`):

* playback: `playVideo, pauseVideo, stopVideo, seekTo, seekBy, getCurrentTime, getDuration, getPlayerState` (**−1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued**), `getPlayerStateObject, getProgressState, getVideoData` (`{video_id,title,author,isLive,isListed,errorCode…}`), `getVideoUrl, getPlaylistId, getPlaylist, nextVideo, previousVideo, getPresentingPlayerType` (1 = content), `getAdState` (**−1 = no ad**), `isLifaAdPlaying`.
* rate: `setPlaybackRate(n)`, `getPlaybackRate()`, `getAvailablePlaybackRates()` → **[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]**. **Verified:** after `setPlaybackRate(1.5)`, `getPlaybackRate()` = 1.5 and `video.playbackRate` = 1.5.
* autoplay/end screens: `setAutonav, setAutonavState, setCreatorEndscreenVisibility, setCreatorEndscreenHideButton` (also `setShortsAutoAdvancedEnabled`).
* misc: `setVolume/getVolume/mute/unMute/isMuted, toggleSubtitles/isSubtitlesOn, toggleFullscreen/isFullscreen, togglePictureInPicture, setSizeStyle, getPlayerSize, updateLastActiveTime, setSleepTimerTimeLeft, setLoopVideo, setShuffle, getStatsForNerds, getDebugText`.
* The plan's bridge commands map directly: `setAutonav(bool)`, `setPlaybackRate(n)`, `pauseVideo()`, `getPlayerState()` — **all four exist**.
* The video element: `#movie_player video.html5-main-video` (a blob: MSE source). Pause-on-open (`noAutoStart`) can use `pauseVideo()`; wait for `getPlayerState() === 1` (or `onStateChange`) then pause once; **could not be tested** (no playback in the sandbox).

### 4.5 "Are you still watching?" / idle dialog

Not reproducible (needs a long playing session). What was found:

* The popup host `ytd-popup-container` is always present (empty). YouTube's dialogs render as `ytd-popup-container > tp-yt-paper-dialog > <renderer>`; the "Video paused. Continue watching?" dialog is a `yt-confirm-dialog-renderer` with a confirm button `#confirm-button` **[source: author knowledge — unverified]**.
* `window._lact` exists (**type `number`, verified**): YouTube's "last user activity" timestamp, the classic hook used by "YouTube NonStop"-style scripts to keep the idle detector quiet. Setting `window._lact = Date.now()` periodically from the MAIN world (page-bridge) is the least invasive way to *avoid* the dialog; clicking `#confirm-button` when it appears (MutationObserver on `ytd-popup-container`) is the fallback. Neither could be verified; the player also exposes `updateLastActiveTime()`.

### 4.6 Shorts

* URL `/shorts/<11-char id>`; element `ytd-shorts` (`ytd-app[is-shorts-page]`); one `ytd-reel-video-renderer` is stamped for the current short and nine `div.reel-video-in-sequence-new` slots for the sequence; vertical nav buttons `div.navigation-container > #navigation-button-up/down`.
* Overlay: `yt-reel-player-overlay-view-model` → `.ytReelPlayerOverlayViewModelMetadataContainer` (channel bar `yt-reel-channel-bar-view-model`: avatar, `a[href="/@handle/shorts"]`, subscribe button) and `.ytReelPlayerOverlayViewModelActionsContainer` → `reel-action-bar-view-model` (`like-button-view-model`, 3 × `button-view-model` = comments, share, remix; `pivot-button-view-model` = sound).
* Comments panel: `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` (×3 in the DOM).
* Links to Shorts: `a[href^="/shorts/"]` everywhere (`a.shortsLockupViewModelHostEndpoint` in lockups). The guide entry: **no href** in the full guide, **`/shorts/`** in the mini guide (see §4.7).
* `/watch?v=<id>` plays a Short in the normal player (YouTube serves it), so the "open in normal player" redirect `/shorts/ID → /watch?v=ID` is valid.

### 4.7 Identifying guide entries WITHOUT text

Full guide (`ytd-guide-entry-renderer > a#endpoint`), logged out, in DOM order:

| Entry | `a#endpoint` attrs | MAIN-world `entry.data.icon.iconType` | Language-free CSS |
|---|---|---|---|
| Home | `href="/"` | `TAB_HOME_CAIRO` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/"])` |
| **Shorts** | **no `href`** (`serviceEndpoint` instead of `navigationEndpoint`) | `TAB_SHORTS_CAIRO` | `ytd-guide-entry-renderer[is-primary]:has(> a#endpoint:not([href]))` |
| Subscriptions | `href="/feed/subscriptions"` | `TAB_SUBSCRIPTIONS_CAIRO` | by href |
| You | `href="/feed/you"` | `ACCOUNT_CIRCLE_CAIRO` | by href |
| History | `href="/feed/history"` | `WATCH_HISTORY_CAIRO` | by href |
| Shopping / Music / Live (section "Explore") | `/channel/UCkYQyvc_i9hXEo4xic9Hh2g`, `/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ`, `/channel/UC4R8DWoMoI7CAwX8_LjQHig` | — | section via `:has(a#endpoint[href=…])` |
| YouTube TV / Kids ("More from YouTube") | `https://tv.youtube.com/?utm_source=youtube_web…`, `https://www.youtubekids.com/?source=youtube_web` | — | `[href*="youtubekids.com"]` |
| Report history | `href="/reporthistory"` | — | by href |

* The `title` attribute and `.title` text are localised ("Shorts") — never match them.
* **Mini guide** (`ytd-mini-guide-renderer > #items > ytd-mini-guide-entry-renderer > a#endpoint`; rendered only when the guide is collapsed; verified at 1100×800): Home `/`, **Shorts `href="/shorts/"`**, Subscriptions `/feed/subscriptions`, You `/feed/you`; `entry.data.icon.iconType` = `TAB_HOME_CAIRO / TAB_SHORTS_CAIRO / TAB_SUBSCRIPTIONS_CAIRO / ACCOUNT_CIRCLE_CAIRO`.
* The **page-bridge can tag every guide entry language-free** by reading `entry.data.icon.iconType` in the MAIN world (verified: `data` is a plain object with `navigationEndpoint`, `icon`, `formattedTitle`, `accessibility`, `isPrimary`, `targetId`) and setting `data-at-peace-entry="shorts"` — an isolated-world content script cannot read `.data`. Recommended for Shorts if the `:not([href])` rule ever breaks.
* "Show more" in a section: `ytd-guide-collapsible-entry-renderer` → `ytd-guide-entry-renderer#expander-item` (button) + `div#expanded > div#expandable-items` + `#collapser-item`.

### 4.8 Channel tabs

* Tabs are `yt-tab-group-shape > div.tabGroupShapeTabs[role=tablist] > yt-tab-shape[role="tab"][tab-title="Videos"][aria-selected]` (+ a last `yt-tab-shape.ytTabShapeLastTab` holding the search icon). **No `href`, no `.data` (null in the MAIN world) — the only identifier is the localised `tab-title`.** Seen on MrBeast: Home, Videos, Shorts, Shows, Posts.
* URL forms (loaded OK): `/@handle` (Home), `/@handle/videos`, `/@handle/shorts`, `/@handle/posts`, `/@handle/playlists`; handle-less channels use `/channel/UC…`. Others per YouTube convention (`/streams`, `/podcasts`, `/store`, `/channels`, `/about`, `/search`) were not tested. `posts` replaced `community`.
* ⇒ `hideShortsTab/hidePostsTab/hideStoreTab` can be done **language-free only via JS that knows the order of the tabs from the URL** (e.g. data in the page response) — see the settings notes. `openVideosTab` works from the URL alone.
* Header: `yt-page-header-view-model` (avatar, `h1.dynamicTextViewModelH1`, `.ytPageHeaderViewModelContentMetadata` rows `@handle • N subscribers • M videos`, description preview, `yt-flexible-actions-view-model` Subscribe). Banner `#page-header-banner > … yt-image-banner-view-model`. The "featured video / trailer" is `ytd-channel-video-player-renderer` inside the first `ytd-item-section-renderer` of the Home tab (the player shows the same "Video unavailable" error in the sandbox).

### 4.9 Search autocomplete dropdown (verified live)

`yt-searchbox` (host classes `ytSearchboxComponentHost ytSearchboxComponentDesktop`, `yt-searchbox-filled-query` / `ytSearchboxComponentHostIsFocused` while typing) contains `input.ytSearchboxComponentInput[name="search_query"][role="combobox"]` and the dropdown **`div.ytSearchboxComponentSuggestionsContainer[role="listbox"]`** (`hidden="true"` while closed; the attribute disappears when open). Rows: `div.ytSuggestionComponentSuggestion` > `div.ytSuggestionComponentText[role="option"][id="searchbox-suggestion:N"][aria-label="<query>"]` (14 rows for "lofi") + a footer "Report search predictions". Pressing Esc closes it. Snapshots: `autocomplete.html`, `autocomplete.png`. `div.sbdd_a` (RYS) is the *pre-2024* dropdown: 0 matches.

### 4.10 Ads, AI, Premium upsells — what exists in the DOM logged out

* **Empty ad hosts always present**: `#masthead-ad` (on `ytd-browse` **and** inside `ytd-rich-grid-renderer`), `#player-ads`, engagement panel `target-id="engagement-panel-ads"` (hidden), player `.ytp-suggested-action` pills. No actual ad element (`ytd-ad-slot-renderer`, `ytd-in-feed-ad-layout-renderer`, `ytd-promoted-*`, `.video-ads`, `.ytp-ad-*`) existed in any snapshot — the sample was served no ads.
* **AI**: (1) `div#ai-companion-button.ytd-masthead[hidden]` (empty, inside `#center`); (2) **AI-generated summaries inside SEARCH RESULTS** — `ytd-video-renderer #expandable-metadata > ytd-expandable-metadata-renderer` whose `#content` holds a `video-summary-content-view-model` (label "Summary", expanded title "AI-generated video summary" + "AI can make mistakes" link): live on 1 of 16 results for "how to cook rice" (see `yt.search.hideAISummary`, a setting PLAN §6.3 lacks); (3) `div#video-summary` exists empty in the watch page's structured description. No "Ask" button/panel anywhere logged out. Engagement-panel `target-id`s seen on watch pages: `PAmodern_transcript_view`, `engagement-panel-searchable-transcript`, `engagement-panel-structured-description`, `engagement-panel-comments-section`, `engagement-panel-ads`, `PAsearch_preview` (purpose unknown), `engagement-panel-macro-markers-description-chapters` (chapters) — none is AI.
* **Premium/mealbars**: no `ytd-mealbar-promo-renderer` etc. appeared logged out.
* Overlay of the sandbox player: `.ytp-gated-actions-overlay` ("Sign in to confirm you're not a bot"), a bot-gate, not a feature to hide.

---

## 5. Open questions (only verifiable logged in, or varied between loads)

**Needs a logged-in session (ask the user to run `npm run selectors` in Zen once; PLAN R5)**
1. Logged-in **masthead**: order/tags of Create, notifications bell (`ytd-notification-topbar-button-renderer`?), avatar button (`button#avatar-btn`?). `yt.masthead.hideCreate` is a structural guess.
2. Logged-in **guide**: the "You" collapsible section, Subscriptions list entries (`/@handle` vs `/channel/UC…`), "Playlists / Your videos / Watch later / Liked videos / Downloads / Your courses / Your clips" hrefs and structure (all `yt.guide.hide*` entries marked `[source: author knowledge]`).
3. **Home feed** with real recommendations: which card renderer is used (`yt-lockup-view-model` as on channel `/videos`, or legacy `ytd-rich-grid-media` as on `/hashtag/…`) — probably account-bucket dependent; Shorts shelf attributes (`ytd-rich-shelf-renderer[is-shorts]` vs `grid-shelf-view-model` vs Shorts cards as grid items), news/posts/playables/"Previously watched" shelves, the chip bar element (`chip-bar-view-model` vs `ytd-feed-filter-chip-bar-renderer`), `ytd-rich-grid-renderer[elements-per-row]`.
4. **Subscriptions feed** (grid vs list view, Shorts shelf, posts, live/upcoming/premiere badge classes, watched bar).
5. **Watch page logged in**: Ask/AI summary UI, Clip/Thanks/Remix buttons, related chip row, "Join", info panels, fundraiser, merch shelf, tickets; whether the autoplay toggle state persists for logged-in users.
6. Shorts player logged in (dislike button tag, subscribe state).

**Needs working playback (impossible in the sandbox: googlevideo.com blocked + bot gate)**
7. Effect of `setAutonav(false)` on `aria-checked` in a healthy player; time it takes for the toggle to appear after `yt-navigate-finish`.
8. End-of-video DOM: `.html5-endscreen`, `.ytp-autonav-endscreen-countdown-overlay`, `.ytp-ce-element` timings; `ended-mode` class; whether `setCreatorEndscreenVisibility(false)` works.
9. Ads: skip button class names, overlay ads, `getAdState()` values while an ad plays; which `.ytp-ad-*`/`.video-ads` nodes exist.
10. "Are you still watching?" dialog tag/ids; whether `window._lact` or `updateLastActiveTime()` suppresses it.
11. Hover preview DOM (`ytd-video-preview`) and what stops it from loading.
12. `noAutoStart`: how to pause reliably without a flash of playback.

**Varied between loads / A-B**
13. Legacy vs new renderers differ per page and per bucket (§1 table): home may serve either; keep both variants for every card selector.
14. Shorts shelves in search: 1–3 per query, custom titles; the 4th shelf type `ytd-shelf-renderer` ("Latest from X") appears only for channel-like queries.
15. `yt-page-data-updated` vs `yt-navigate-finish` order differs on initial load (see §4.1).
16. Sorry/captcha gating (`google.com/sorry`) is per IP *and* per video id.

**Firefox/Zen**
17. Everything was probed in Chromium 141. `:has()`, `:nth-child(n of S)`, `filter` on `html` with fixed descendants (PLAN R4) and `world:"MAIN"` access to `entry.data` were **not** exercised in Firefox 140 — Phase 0's Firefox smoke test should add one probe of `entry.data.icon.iconType` through the page-bridge.

**Other**
18. Language independence of row structure: only English was probed; the `ytContentMetadataViewModel*` row/delimiter structure is language-free by construction but RTL layouts were not checked.
19. Unknown purpose of engagement panel `PAsearch_preview` (present on watch pages).

---

## 6. Deviations from the PLAN's assumptions (summary — details in the sections above)

1. **There is no explore/trending page any more**: `/feed/trending` and `/feed/explore` redirect to `/`. Drop `explore` from §6.1 (hubs like `/gaming` were not tested).
2. The PLAN's example `#chips-wrapper` does not exist (0 matches); the home chip bar lives in `ytd-rich-grid-renderer > #header` (`chip-bar-view-model` on channel `/videos`).
3. **AI-generated summaries are rendered inside search results** (`ytd-video-renderer #expandable-metadata > ytd-expandable-metadata-renderer` with a `video-summary-content-view-model`; seen on 1 of 16 results logged out) — PLAN §6.3 only knows masthead/watch-page AI features. Add **`yt.search.hideAISummary`** (tag `ai`) and keep `yt.watch.hideChapters` independent of it (both use `ytd-expandable-metadata-renderer`).
4. **The watch sidebar no longer uses `ytd-compact-video-renderer`**: every sidebar card is a `yt-lockup-view-model` (0 legacy renderers in any snapshot). Same for `/playlist` (lockups in `yt-item-section-renderer`) and channel Videos.
5. **`ytd-watch-flexy` is present (hidden) on every page** and contains the whole player DOM: `.ytp-*` selectors match on non-watch pages; page-gating is mandatory (the PLAN's `data-at-peace-page` prefix does this).
6. `#related` sits in `#secondary-inner` next to `ytd-playlist-panel-renderer#playlist`, `#chat-container`, `#panels`, `#donation-shelf` (verified on 4 exact snapshots): hiding it never hides the playlist/chat/panels, as PLAN §6.2 requires. `#player-ads` is *inside* `#related` on plain videos but a *sibling* on playlist/live pages — hide it separately.
7. **Shorts guide entry has no `href`** (full guide) and `href="/shorts/"` (mini guide); the community's selectors are English `title="Shorts"`. Language-free solutions exist (§4.7) incl. MAIN-world `entry.data.icon.iconType`.
8. **Channel tabs have no href and no `.data`**: Shorts/Posts/Store tab hiding cannot be language-free from CSS alone.
9. **`ytw-*` and camelCase classes**: legacy `ytd-` tag selectors and BEM `yt-spec-…__…` classes are dying; list both.
10. `yt.home.limitRows` is **not feasible in CSS**; `yt.general.hideLiveBadgesAndPremieres` should be dropped; `yt.watch.hideAsk` has no known selector; `yt.watch.hideThanks/hideClip` lack language-free selectors.
11. Page-bridge (PLAN §7) — all four commands (`setAutonav`, `setPlaybackRate`, `pauseVideo`, `getPlayerState`) exist. **Add two bridge duties**: (a) tag guide entries by `data.icon.iconType` (Shorts, and any other entry without a stable href); (b) optionally keep `window._lact` fresh for `dismissStillWatching`.
12. `ytd-app[is-watch-page]` / `[is-shorts-page]` are free page-type signals for CSS (no engine round-trip).
13. A **`hashtag` page** (`ytd-browse[page-subtype="hashtag-landing-page"]`) uses the legacy `ytd-rich-grid-media` card — currently falls under `other` in §6.1.
14. **`autoTheater` can be a cookie**: loading a watch page with cookie `wide=1` (`.youtube.com`, `/`) opens it in theater mode (verified); clicking `.ytp-size-button` also sets it. Clicking per navigation is only the SPA fallback.
15. **Mixes** cannot be recognised by `list=RD` alone: 21 of 26 sidebar lockups on the exact lofi/music snapshots carry `&list=RD…&start_radio=1` (≈ every card on the Rick page). A Mix is a *collection* lockup (`yt-collection-thumbnail-view-model`) with such a link (seen once, on the re-parsed Rick dump).
16. **Shorts appear in search two ways**: `grid-shelf-view-model` shelves **and** as ordinary `ytd-video-renderer`s with `overlay-style="SHORTS"` (12 on the "mrbeast" results). `yt.search.hideShorts` needs both.
17. **Channel/handle filters**: watch-sidebar lockups expose the channel *name only* (no link, no handle); search rows link either `/@handle` or `/channel/UC…`; channel `/videos` cards have no channel at all.
18. The `hideViewCount` markup of the watch page switches with the description state: collapsed = `ytd-watch-info-text #info > span:first-child` (abbreviated, "9.7M views 1 year ago"), expanded/live = `#view-count` (+ absolute date in `#info`).

---

## 7. Re-running the research

```bash
# one live page: collapsed outline of a subtree, a screenshot and an exact snapshot
node tools/yt-probe.mjs /@MrBeast/videos --root 'ytd-browse' --depth 8 --shot tests/e2e/artifacts/research/x.png --dom tests/e2e/artifacts/research/x.dom.json

# count selectors on a live page (matches / visible) — `--count-file` takes one selector per line
node tools/yt-probe.mjs '/results?search_query=lofi' --count 'ytd-search ytd-video-renderer' --count 'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)'

# evaluate JS on a live page (e.g. read the MAIN-world data of the guide entries)
node tools/yt-probe.mjs / --eval "[...document.querySelectorAll('ytd-guide-entry-renderer')].map(e => e.data?.icon?.iconType)"

# offline: many snapshots x many selectors -> matrix (no network)
node tools/yt-probe.mjs tests/e2e/artifacts/research/*.dom.json --count-file my-selectors.txt
```

Habits that kept this research honest: (1) take `--dom` snapshots (never re-parsed HTML) and validate offline; (2) use **one load per page type** and 40–60 s between loads (the `/sorry/` captcha lasts ~5 min and latches per video id); (3) `--eval` the MAIN-world state (`ytcfg.get('LOGGED_IN')`, `entry.data`) rather than guessing; (4) never trust a selector from a list until it matches a snapshot; (5) always run a CSS "lab" (inject the rule, measure `getBoundingClientRect` of the neighbours, look at the screenshot) to catch holes — the guide gutter and the channel header were found that way.

### Artifact index (`tests/e2e/artifacts/research/`, git-ignored)

| Files | What |
|---|---|
| `<page>.dom.json` | **exact DOM snapshots** (the evidence behind every `[live]` count): `home`, `home-narrow`, `search-lofi`, `search-mrbeast`, `search-rice`, `channel-home|videos|shorts|posts`, `hashtag`, `playlist`, `feed-history`, `feed-subscriptions`, `shorts`, `watch-chapters`, `watch-live`, `watch-playlist`, `watch-music` (+ `watch-rick` HTML only, see §0) |
| `<page>.png`, `<page>.outline.txt`, `<page>.events.json` | screenshot, collapsed outline of the page subtree, SPA event log of that load |
| `lab-*.json`, `lab-<page>-<experiment>.png` | CSS-lab measurements and screenshots (home, narrow, search, channel, watch) |
| `autocomplete.html/.png` | search dropdown (open) |
| `live1.log.json`, `watch-rick.player-info.json`, `shorts.info.json` | player-API / autonav / theater / SPA-event experiments |
| `watch-rick.html`, `watch-rick.player-early.html` | the first (re-parsed) Rick Astley dumps — only source of end-screen class names |
| `feed-trending.*`, `feed-explore.*`, `feed-you.*`, `channel-playlists.*` | HTML dumps proving the trending/explore redirect and the signed-out feeds |

