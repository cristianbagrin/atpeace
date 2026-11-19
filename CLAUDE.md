# At Peace: instructions for Claude

## Delivering an update

Every change that ships goes out as a new version, and releasing is automatic:

1. Add a line under `## Unreleased` in `CHANGELOG.md` (for people, not developers: what changed for them, in
   plain words), then run `npm run release -- patch` (`minor` for new settings or features).
2. Push `main`. The Release workflow (`.github/workflows/release.yml`) checks the code, submits the listed
   version to addons.mozilla.org with those notes, uploads and publishes it on the Chrome Web Store, and tags
   it `vX.Y.Z`. A version number can be used only once. Chrome refuses an upload while an earlier version is
   in review; send it later with Actions → Release → Run workflow, store = chrome.

Never open a pull request; push straight to `main`. Keep `docs/store/reviewer-notes.txt` under 3,000
characters (Mozilla's limit; `tools/amo-metadata.mjs` checks).

## Testing in a real browser

- Chrome: `npm run build:chrome`, unzip, then start Chrome with `--headless=new --enable-unsafe-extension-debugging --remote-debugging-port=<port>` and load it over CDP with `Extensions.loadUnpacked`.
- Firefox/Zen: start it headless with `--remote-debugging-port` and drive it over WebDriver BiDi (`webExtension.install`). Pin the extension's UUID in the profile's `user.js` (`extensions.webextensions.uuids`). Call `browsingContext.activate` on the YouTube tab first, or the welcome tab keeps focus and the page never scrolls or loads comments.
