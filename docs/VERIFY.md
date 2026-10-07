# Checking At Peace in Zen (10 to 15 minutes)

The automated tests ran against real Firefox and against saved copies of YouTube's pages, but the
build environment had no YouTube account and could not play video. This list covers exactly what
could not be checked there. Do it once, in Zen, signed in to YouTube.

You do not need to read code. For each step: turn something on, look at the page, compare with
"Expect". If it is wrong, write down the setting name (the section and the exact label in Settings)
and what you saw. Section "When something fails" at the bottom says how to collect more.

What you need: Zen (or Firefox 140 or newer), a YouTube account that is signed in, a video that
plays for at least a minute (any), and a channel you are subscribed to.

## 0. Install it for the test (2 minutes)

1. Get the code: `git clone` the repository, or download it, and run `npm install` once if you want to
   run the checks at the end. Loading the extension itself needs no build step.
2. In Zen open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and pick the `manifest.json` in the project folder.
   It stays until you restart Zen; load it again after a restart.
4. A **Welcome** tab opens. Choose **Untouched** ("nothing hidden") so you start from a clean page, leave
   the breathing pause off for now, and finish. (You will test the pause in step 9.)
5. Open `https://www.youtube.com/`. Click the toolbar puzzle-piece button; At Peace should be listed.
   The welcome page says to pin it: confirm that the wording ("Pin to Toolbar" beside At Peace) matches
   what Zen shows. Zen's menu may be named differently; note it if so.
6. Open the settings (the popup's **All settings** button, or the extension's Options in `about:addons`). Everything below happens
   there and in the popup.

Tip: keep the settings open in one tab and YouTube in another. Changes apply to YouTube at once, no
reload needed. The list of sections on the left of the settings shows, beside each YouTube section, how
many of its switches are on (and "On" beside Mindful Pause), so you can see at a glance that a switch
registered; the number should go up by one for each switch you turn on below.

## 1. Top bar, signed in (1 minute)

Settings, **Top bar**. Turn on, one at a time, and look at YouTube's top bar:

| Turn on | Expect | If it fails |
|---|---|---|
| Hide the Create button | The "Create" (camera) button disappears. Bell and your avatar stay. | `yt.masthead.hideCreate` |
| Hide the notifications bell | The bell disappears. Create and avatar stay. | `yt.masthead.hideNotifications` |
| Hide the banner ad | Nothing visible changes unless an ad banner shows on the page. Skip if none. | `yt.masthead.hideMastheadAd` |

Turn them off again when done (or leave them, it makes no difference to later steps).

## 2. Left sidebar, signed in (2 minutes)

Settings, **Left sidebar**. If the sidebar is collapsed, open it with the menu button. Turn on, then look:

| Turn on | Expect | If it fails |
|---|---|---|
| Hide Playlists, Hide Your videos, Hide Watch later, Hide Liked videos, Hide Downloads, Hide Your courses | Each of those entries vanishes from the sidebar's "You" area (open "Show more" if it is folded). Entries you do not have anyway cannot be checked. Nothing else in the list disappears. | The id of the entry that stayed, for example `yt.guide.hideWatchLater` |
| Hide the channel list | The list of channels you subscribe to is gone. "Subscriptions" itself stays. | `yt.guide.hideSubscriptionsSection` |
| Hide Settings and Help | The bottom block with Settings, Report history, Help, Send feedback is gone. | `yt.guide.hideSettingsSection` |
| Hide the whole sidebar | The sidebar is gone and the page uses the freed room (no empty strip on the left). Turn it off again. | `yt.guide.hideAll` |

Home, Shorts, Subscriptions, You and History entries were checked live before. If the icon strip shows
instead of the full list (narrow window), try the same with **Hide the icon strip**.

## 3. Home feed, signed in (2 minutes)

Open `https://www.youtube.com/`. Settings, **Home**, and **All of YouTube**:

| Turn on | Expect | If it fails |
|---|---|---|
| Hide the category bar | The row of chips ("All", "Music", ...) is gone and the grid moves up without a gap. | `yt.home.hideChips` |
| Hide Shorts on the home feed | The Shorts row(s) in the feed are gone, no empty space. | `yt.home.hideShortsShelf` |
| Hide community posts | Post cards between videos are gone. Skip if you see none. | `yt.home.hidePostsShelf` |
| Hide the news row | The "Breaking news" or "Top news" row is gone. It only appears some days; skip if none. | `yt.home.hideNewsShelf` |
| Hide every extra row | Only plain video cards remain. | `yt.home.hideOtherShelves` |
| Thumbnails: Blur until hovered | Thumbnails are blurred; hovering one makes only that one sharp. Switch back to "Show". | `yt.general.thumbnails` |
| Show YouTube in grayscale | The whole page, including thumbnails and the player, loses colour. Turn it off. | `yt.general.grayscale` |
| Hide videos you have already watched | Cards with a red watched bar are gone. | `yt.general.hideWatched` |
| Hide Mixes | Cards titled "Mix - ..." (with a stack icon) are gone. Skip if your feed has none. | `yt.general.hideMixes` |
| **When I open YouTube**: "Show a calm empty page" | The feed is replaced by a short calm message; the sidebar and search still work. | `yt.home.feedMode` |
| **When I open YouTube**: "Go to Subscriptions", then click the YouTube logo | Opening or clicking Home takes you to your Subscriptions. | `yt.home.feedMode` |
| **When I open YouTube**: "Go to Watch later" | Opening Home lands on your Watch later playlist. | `yt.home.feedMode` |

Put **When I open YouTube** back to "Show the home feed" afterwards. Reload the home page once with each
redirect to check that a full page load works too, not only a click on the logo. Back (alt + left
arrow) must still work and must not bounce you forward again.

## 4. Subscriptions feed (1 minute)

Open Subscriptions in the sidebar. Settings, **Subscriptions feed**. Turn on:

| Turn on | Expect | If it fails |
|---|---|---|
| Hide Shorts | The Shorts row is gone. | `yt.subs.hideShorts` |
| Hide live streams | Live items are gone, if any are in your feed. | `yt.subs.hideLive` |
| Hide upcoming premieres | "Upcoming" and "Premieres" items are gone, if any. | `yt.subs.hideUpcoming` |
| Hide videos you have watched | Watched videos are gone. | `yt.subs.hideWatched` |
| Hide community posts | Posts are gone, if any. | `yt.subs.hidePosts` |

Both the grid and the list view of this page exist; if you use the list view, try it there as well.

## 5. A video page, signed in (2 minutes)

Open any video that is not live. Settings, **Video page**. Turn on:

| Turn on | Expect | If it fails |
|---|---|---|
| Hide Clip, Hide Thanks, Hide Ask (AI) | Those buttons under the video are gone. Not every video offers them; if the button is not there to begin with, skip it. The other buttons (Like, Share, Save) stay. | `yt.watch.hideClip`, `yt.watch.hideThanks`, `yt.watch.hideAsk` |
| Hide the Join button | On a channel with memberships, "Join" is gone. Skip otherwise. | `yt.watch.hideJoinButton` |
| Hide the topic chips above related videos | The chip row above the sidebar list is gone. | `yt.watch.hideRelatedChips` |
| Hide information boxes, Hide fundraisers, Hide shopping and product panels, Hide the merchandise shelf, Hide the tickets shelf | Boxes under or beside the video are gone where a video has them. Skip those you cannot find. | the matching id |
| Hide related videos | The sidebar list is gone and the player widens to use the room. The control bar under the video must reach the full width (no strip at the right). Hold your finger on this one: it is the layout nudge. | `yt.watch.hideRelated` |
| Hide comments | The comments, including the short preview under the description, are gone. | `yt.comments.hideAll` |

Open a video from a **playlist** and a video that has **chapters**. With "Hide related videos" on, the
playlist panel must stay (it is not "related") and so must the title, the player and the search box.

### Channel tabs

Open a channel you know. Settings, **Channel pages**. Turn on "Hide the Shorts tab", "Hide the Posts tab",
"Hide the Playlists tab". Expect: exactly those tabs vanish from the row (Home and Videos stay). If the
channel has Live, Podcasts, Store tabs, try "Hide the Live tab", "Hide the Podcasts tab", "Hide the Store
tab" as well. Failure ids: `yt.channel.hide<Name>Tab`.

Then turn on **Open channels on their Videos tab**: clicking a channel name from a video or a search
result lands on `/videos`, while clicking the Home tab yourself still shows Home.

## 6. Playback behaviours (3 minutes)

These need a video to actually play. Settings, **Video page**, "Playback". Turn on one thing at a time.

1. **Turn off autoplay.** Open a video. Look at the player's control bar: the "Autoplay" switch must be
   off. Open a second video from the sidebar: it must still be off. Let a short video end (drag the
   progress bar to the last 5 seconds). Expect: no "Up next in 8" countdown and no new video starts.
   Fail: `yt.watch.disableAutoplay`.
2. **Do not start videos by themselves.** Reload a video page. Expect: the video is paused at the start
   (a short flash of the first frame is fine). Press the play button or space: it plays and is not
   paused again. Open another video by clicking it: that one should start normally because you
   asked for it. Fail: `yt.watch.noAutoStart`.
3. **Open videos in theater mode.** Open a video. Expect: the wide layout (video across the page, details
   below). Switch to the normal size yourself: it stays that way for that video. Fail:
   `yt.watch.autoTheater`.
4. **Playback speed**: choose 1.5x. Open a video: it plays at 1.5x (the player's settings menu says so).
   Press `<` to slow it down yourself: it must stay at your speed for that video. Fail: `yt.watch.defaultSpeed`.
   Put it back to "Leave as YouTube sets it".
5. **End-screen cards and grid** (Settings, **Player**): turn on "Hide end-screen cards" and "Hide the
   suggestions grid at the end". Play to the last 20 seconds of a video that has end cards (many do):
   no cards over the picture. At the very end, no wall of suggestions over the player. Fail:
   `yt.player.hideEndscreenCards`, `yt.player.hideEndscreenWall`.
6. **Skip "Are you still watching?"**: this one needs patience. Turn it on, start a long video or playlist
   in a background tab, leave it for a couple of hours when convenient. Expect: playback is not
   interrupted by the prompt. If you cannot wait, skip it and say so. Fail: `yt.watch.dismissStillWatching`.
7. **Turn off hover previews** (Settings, **All of YouTube**): on the home page point at a thumbnail and
   wait three seconds. Expect: no moving preview and no preview sound. The buttons that appear on a
   thumbnail (Watch later, Add to queue) still work. Fail: `yt.general.disableHoverPreview`.
8. **Calm shouting titles**: set to "Sentence case". A title with CAPITAL WORDS becomes ordinary text;
   "4K", "NASA", "USA" stay. Fail: `yt.general.calmTitles`.

## 7. Ads (1 minute, only if you see ads; they often appear when signed out of Premium)

Settings, **All of YouTube**, "Hide ad slots and sponsored cards"; **Video page**, "Hide ad panels beside
the video"; **Search results**, "Hide sponsored results". Expect: no sponsored cards in the feeds or the
search list and no ad panel beside a video. At Peace deliberately does **not** touch video ads inside the
player (it would hide the Skip button too); that is not a bug. Fail: `yt.general.hideAds`,
`yt.watch.hidePlayerAds`, `yt.search.hideAds`.

## 8. Shorts (1 minute)

Settings, **Shorts**, "When I open a Short":

| Choose | Expect | If it fails |
|---|---|---|
| Open in the normal player | Clicking a Short, or pasting a `/shorts/...` address, opens it as an ordinary video. Back works. | `yt.shorts.mode` |
| Block Shorts | You see a calm "Shorts are off" page. | `yt.shorts.mode` |

Put it back to "Play Shorts as usual". If you watch Shorts signed in, also check "Hide comments on
Shorts" and "Hide Subscribe on Shorts" there.

## 9. Mindful Pause and Focus, a sanity pass (2 minutes)

1. Settings, **Mindful Pause**: turn on "Pause before opening". In a new tab open `youtube.com`.
   Expect: a dark indigo page with a dial of fine tick marks and a mint circle that slowly swells and
   shrinks, the small line "Before YouTube" above it and the words "Breathe in…". After the breath the
   line above reads like "4th time today", the question "Open YouTube?" appears, and two choices: the
   main button **Close YouTube** and **Continue for** with a row of minute choices (5, 10, 15 ...). The
   bottom right says "Press Esc to close" (Esc is the same as Close), and nothing else is on the page:
   no address, no question to answer. Press Continue: YouTube opens. Open another YouTube tab: no
   second pause while the session lasts. (Set "Default time when I continue" to 5 minutes and wait if you
   want to see "Your 5 minutes are up." with **Leave YouTube** and **Take a breath**, and the video
   pausing. It always appears; there is no setting for it.)
2. Press **Close YouTube** on a fresh pause: the tab goes back or closes.
3. Popup, under **Block YouTube for**, press **25 min**. Expect: open YouTube tabs turn into the same
   indigo page, now saying "YouTube is closed for now." with a large countdown and the time it ends, and a
   new tab to YouTube does the same. End it with the early-exit control (it asks you to wait 30 seconds
   by default). Check that the countdown matches the clock. Afterwards the popup shows three stat tiles
   (time **on YouTube**, **opens**, **turned back**) that match what you just did.
4. Keyboard shortcuts: **Alt+Shift+P** turns At Peace on and off, **Alt+Shift+F** starts a 25 minute
   block (end it right after), **Alt+Shift+H** starts "Hide an element" on a YouTube page (Esc leaves it).
   If Zen already uses one of these, the shortcut simply does nothing: rebind it in `about:addons`,
   gear, "Manage Extension Shortcuts", and note which one clashed.
5. Pick a thumbnail with "Hide an element" (popup, **Hide an element**): click a video card, press
   **Hide**. Reload: it is still hidden, and the rule shows in Settings, **Advanced**.
6. Turn the pause off again, set the preset back to what you want to keep, and end any focus block.

## 10. Done: what to send back

- Anything marked "Fail" above: the setting id (or the section and label), the page you were on (home,
  search, video, ...), and one sentence on what you saw. A screenshot helps.
- The `[At Peace]` lines from the console, if any (below).
- Your Zen version (`about:support`, "Version") and whether you were signed in.

## 11. Keeping it after the check (optional, 5 minutes)

A temporary add-on disappears when Zen restarts. To keep At Peace, sign it once for yourself (free, unlisted,
never published):

1. Make an account at https://addons.mozilla.org/ and open https://addons.mozilla.org/developers/addon/api/key/
   to create an API key and secret.
2. In the project folder:

   ```sh
   npm install
   export WEB_EXT_API_KEY=...         # the "JWT issuer"
   export WEB_EXT_API_SECRET=...      # the "JWT secret"
   npm run sign
   ```

3. When it finishes, drag the `.xpi` from `web-ext-artifacts/` onto a Zen window and accept the prompt.
   Remove the temporary copy first (`about:debugging`, **Remove**) so there is only one At Peace.

## When something fails

### Copy the console messages

At Peace prefixes everything it reports with `[At Peace]`.

- **On the YouTube tab:** press `F12` (or `Ctrl+Shift+I`, `Cmd+Option+I` on a Mac), open **Console**, and
  type `[At Peace]` in the filter box. Copy the lines.
- **From the background:** `about:debugging#/runtime/this-firefox`, find At Peace, **Inspect**, **Console**.
  Or press `Ctrl+Shift+J` (Browser Console) and filter for `[At Peace]`.
- For more detail turn on Settings, **Advanced**, "Debug logs" ("Show advanced" must be on), reproduce the
  problem, then copy the lines. Turn it off again.

### Hide it yourself right now

The element picker (popup, **Hide an element**, or Alt+Shift+H) hides anything the settings missed, and
keeps the rule. That is the quickest way to a calm page while a selector is being fixed.

### Check selectors from the command line (needs Node and Playwright)

If you have Node 22 and Playwright, you can have the project test every selector against the live pages
using your own signed-in profile. Sign in once, then run the report:

```sh
npm install
export PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs   # only if it is not at the default
node tools/yt-probe.mjs / --headed --wait 120000 --profile ~/.cache/at-peace/yt-profile   # sign in, wait
npm run selectors -- --live --out /tmp/selector-report.md --pause 20
```

It prints which settings matched nothing on a page where they should. The default report path is
`docs/selector-report.md`; `--out` keeps the committed copy untouched. Send back `/tmp/selector-report.md`
(it contains no personal data: only selector counts).

Setting ids in the report look like `yt.guide.hideWatchLater`. The same id appears in the failure column
of each table above.

### Going back to normal

Settings, **Backup & reset**, **Reset…** puts every setting back to its default (YouTube
untouched). Removing the add-on in `about:addons` removes its data too.
