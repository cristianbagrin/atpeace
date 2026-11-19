# Publishing At Peace on addons.mozilla.org (AMO)

The self-distributed route (docs/RELEASING.md) keeps working. This is the public, listed one: a page on
addons.mozilla.org, "Add to Firefox" for everyone, updates delivered by Mozilla.

## How the two routes fit together

- Same add-on id (`at-peace@cristianbagrin`). Settings are kept when someone moves from one to the other.
- A listed version must not carry `update_url`; `npm run build:listed` makes that package (the repo's
  `manifest.json` is not changed, so the unlisted release flow is untouched).
- A version number can only be used once per add-on, across both channels (Mozilla rejects a repeat as a
  duplicate). 0.2.1 went out unlisted, so the first listed version is 0.2.2, bumped by hand in a commit that is
  not named "Release x.y.z" so the unlisted workflow does not take the number. After that, one version per
  channel: build the next number once and either release it unlisted (`npm run release`) or submit it listed.
- Copies installed from the unlisted `.xpi` (up to 0.3.3) are moved to the AMO 0.5.0 file by the last entry
  in `atpeaceupdates`; after that Mozilla updates them.

## Steps

1. `npm run build:listed` writes `web-ext-artifacts/at-peace-<version>-listed.zip`.
2. addons.mozilla.org/developers/ > **Submit a New Add-on** (or **Upload New Version** if the id already
   exists there from the unlisted channel) > **On this site** (listed) > upload the zip.
3. "Do you need to submit source code?" **No.** The package is plain, unminified JavaScript.
4. Fill in the listing from the text below, add screenshots, set the licence and the privacy policy.
5. Submit. Mozilla reviews it (hours to a couple of weeks for a first version). You get an email; once
   approved, the page is live.

## Listing text

**Name:** At Peace

**Summary (max 250 chars):** A calm, intentional YouTube. Hide what you don't want to see, and add a breath,
a timer or a schedule between you and the feed.

**Categories:** Appearance and Productivity (AMO lets you pick up to two).
"Other" and tag it with the first available of: Appearance, Productivity.

**Description:**

> At Peace makes YouTube quieter and puts a little friction between you and the feed. Everything runs on
> your computer. An optional account keeps your settings in step across browsers; without it, nothing is sent anywhere.
>
> DECLUTTER: about 140 switches, each hiding one thing: the home feed, Shorts, comments, related videos,
> the sidebar, buttons under a video, view counts, upload dates, ads and Premium promos, AI summaries, end
> screens, hover previews and more. Thumbnails can be shown, blurred or grayscale until you hover, or
> hidden. An element picker hides anything the settings missed.
>
> REDIRECT: home can show a calm empty page or send you to Subscriptions, Watch later or a page of your
> own. Shorts can open in the normal player or be blocked.
>
> BEHAVE: turn autoplay off, stop videos from starting by themselves (while a playlist you started keeps
> playing), open videos in theater mode, start every video at a speed you chose, skip "Are you still
> watching?", and show search results as a grid like the home page.
>
> MINDFUL PAUSE: before YouTube (or any site you add) opens, a breathing screen shows how often you opened
> it today. Then you choose to close it or continue for a set time.
>
> FOCUS: block YouTube for 25 minutes, an hour or the rest of the day with one click, set weekly schedules
> and a daily limit. A settings lock can make it harder to undo your own choices.
>
> OWN IT: four built-in presets and your own, export and import, light and dark theme, keyboard shortcuts.
>
> PRIVACY: no analytics, no remote code. The account is optional and syncs only settings and presets. Usage numbers stay in your browser for 90 days.
> Other sites are only touched if you add them to Mindful Pause, and the browser asks first.

**Support email:** chris@cristianbagrin.com

**Privacy policy:** paste the text of [PRIVACY.md](../PRIVACY.md) into the "Privacy policy" field.

**Licence:** "All Rights Reserved" (matches [LICENSE](../LICENSE)).

**Notes to the reviewer** (the "Notes for Reviewers" box):

> Plain JavaScript, no build step, no minification, no remote code; the zip is the repository's
> manifest.json, icons/ and src/. The content script runs on www.youtube.com to hide page elements and
> apply the user's chosen behaviours. `declarativeNetRequest` is used for the user's own redirects and
> blocks. `scripting` and the optional `*://*/*` host permission are used only when the user adds another
> site to Mindful Pause (the browser prompts for that single site). data_collection_permissions is "none":
> the add-on makes no network requests of its own. To test: install, open youtube.com, open the toolbar
> popup and switch any "Hide ..." toggle; the element disappears.

## Screenshots

`docs/store/` holds two from the real settings page and popup. AMO wants 2 to 5; the best ones show the
extension *on YouTube*, which needs a real browser:

- YouTube home with the "Deep work" preset (clean, grayscale, blurred thumbnails), before/after.
- A watch page with related videos and comments hidden.
- The Mindful Pause breathing screen with the "Continue for N minutes" choice.
- The element picker highlighting something.

Take them in Firefox at about 1280x800.
