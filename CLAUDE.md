# At Peace: instructions for Claude

## Delivering an update

At Peace is published publicly (signed by Mozilla, listed on addons.mozilla.org), so every change that
ships goes out as a new version. When you finish a change the user will ship, always:

1. Add a line under `## Unreleased` in `CHANGELOG.md`, then run `npm run release -- patch` (`minor` for
   new settings or features). See `docs/RELEASING.md`.
2. Build the zip: `npx web-ext build --overwrite-dest` (writes `web-ext-artifacts/at-peace-<version>.zip`).
3. Hand the user, in the same reply, both of these (copy them to the session scratchpad first, so the
   app can open them, and send them with SendUserFile):
   - the zip, `at-peace-<version>.zip`;
   - the version notes: that version's section of `CHANGELOG.md`, as `at-peace-<version>-notes.md`.
   Also paste the notes in the reply, so they can be copied into the store's "Version notes" field.
4. Push the release commit to the working branch. Do not open a pull request unless asked.

Write the notes for people, not developers: what changed for them, in plain words.
