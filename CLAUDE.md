# At Peace: instructions for Claude

## Delivering an update

At Peace is published publicly (signed by Mozilla, listed on addons.mozilla.org), so every change that
ships goes out as a new version. When you finish a change the user will ship, always:

1. Add a line under `## Unreleased` in `CHANGELOG.md`, then run `npm run release -- patch` (`minor` for
   new settings or features). See `docs/RELEASING.md`.
2. Build the store zip: `npm run build:listed` (writes `web-ext-artifacts/at-peace-<version>-listed.zip`).
   Never hand over a plain `web-ext build` zip: it carries `update_url`, which addons.mozilla.org rejects
   for listed add-ons. See `docs/PUBLISHING.md`.
3. Hand the user, in the same reply, both of these (copy them to the session scratchpad first, so the
   app can open them, and send them with SendUserFile):
   - the zip, `at-peace-<version>-listed.zip`;
   - the version notes: that version's section of `CHANGELOG.md`, as `at-peace-<version>-notes.md`.
   Also paste the notes in the reply, so they can be copied into the store's "Version notes" field.
4. Push straight to `main` (the default branch), and to the working branch. Never open a pull request: the user does not want to approve
   anything by hand. Before releasing, fetch and merge `main`, and check `manifest.json`'s
   version is newer than the latest published one (a version number can be used only once).

Write the notes for people, not developers: what changed for them, in plain words.
