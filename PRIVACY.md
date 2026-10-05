# Privacy

At Peace keeps everything on your computer. Nothing is sent anywhere.

- No analytics, no telemetry, no crash reports.
- No accounts, no sync, no server of ours.
- No remote code, remote fonts or remote images. Everything the extension shows ships inside it.
- The extension makes no network requests of its own. The manifest declares
  `data_collection_permissions: { "required": ["none"] }`, which is Firefox's way of saying so.

## What it can see

- **youtube.com.** The extension runs on `www.youtube.com` so it can hide parts of the page, follow
  navigation and apply the behaviours you chose. It reads the page only to do that. Page content is
  never stored or sent.
- **Other sites.** Only if you add a site to Mindful Pause. The browser then asks for permission for
  that one site, and you can take it back in `about:addons` at any time.
- **Browsing history.** At Peace does not read it and does not have the permission to.

## What is stored, and where

Everything lives in the browser's own extension storage (`storage.local`) for this add-on, inside your
Firefox or Zen profile. It is not synced to any account.

| What | Why | How long |
|---|---|---|
| **Settings** (every toggle you changed, custom hide rules, custom CSS, filter words, schedules, the list of pause sites) | So your choices survive restarts | Until you reset or uninstall |
| **Presets you saved** | So you can switch between your own setups | Until you delete them |
| **Settings lock** (if you set one): a mode, and for a password lock a salted PBKDF2 hash | So the lock can check a password without storing it | Until you remove the lock |
| **Run state** (when a Pause session or a focus block ends, extra time you asked for today) | So blocks and sessions keep working after a restart | Short lived; it only describes what is in force right now |
| **Usage stats**: per day, minutes active on a site, how many times it was opened, how many times you turned back or continued, how many times a block stopped you | The numbers in the popup and "Your week" in the settings, and the daily limit | **90 days**, then older days are removed |
| **Intentions**: the one-line answers you typed on the pause screen ("what did you come for?"), if you turned that question on | So you can look back at them | At most the **last 20** per site; also removed with the usage history |
| **Install bookkeeping** (install time, whether the welcome page was finished, the version) | So the welcome page shows once and settings can be upgraded | Until you uninstall |

Two small things live outside the extension's storage. The Pause breath counter and a redirect loop
guard use the page's `sessionStorage` for the current tab only; both are gone when the tab closes.

## How to clear it

- **Usage stats and intentions:** Settings, then "Your week", then **Clear usage history…**. It also
  resets today's count against the daily limit, so it needs an unlock if the settings lock is on.
- **Settings:** Settings, then Export / Import / Reset, then **Reset…**. Presets you saved stay; delete
  them in the Presets dialog.
- **Everything:** remove the add-on in `about:addons`. Firefox deletes its storage with it.

## Backups

**Export** writes a file with your settings and presets to wherever you save it. At Peace does not read
or send that file; treat it like any other file on your disk. It never contains usage stats,
intentions, or the settings lock.

## Questions

Open an issue on the project's repository, or read the code: it is plain JavaScript in `src/`, and
what is there is exactly what ships.
