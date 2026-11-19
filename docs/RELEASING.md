# Releasing At Peace

```
npm run release -- patch  ->  git push  ->  GitHub Actions: check, then publish to addons.mozilla.org and the Chrome Web Store
```

`npm run release` turns `## Unreleased` in CHANGELOG.md into the new version and makes the commit
"Release x.y.z". Pushing it to `main` starts `.github/workflows/release.yml`:

1. lint, tests, `verify:package`, then `build:listed` (no `update_url`) and `build:chrome`;
2. addons.mozilla.org: submits the listed version with that version's CHANGELOG section as the version
   notes and `docs/store/reviewer-notes.txt` as the notes to reviewer (at most 3,000 characters);
3. Chrome Web Store: uploads and publishes (`tools/cws-publish.mjs`, a service account; API v2);
4. tags `vx.y.z`. A tagged version is never sent again.

Mozilla and Google still review each version; people get it after that, on their own.

## Secrets (repository → Settings → Secrets and variables → Actions)

- **Mozilla:** `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` from
  [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/)
  (or the older single `MOZILLA_GITHUB` secret holding both).
- **Chrome:** `CWS_SERVICE_ACCOUNT` (the service account's JSON key, the same one Chinese Brain uses),
  `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID` = `ejplinicdjdifcdagflblibbeldpfoig`.

Each store is skipped while its secrets are missing. Chrome refuses an upload while an earlier version is
in review: the run carries on, and Actions → Release → Run workflow, store = chrome, sends it later.

## Copies installed from a file

Versions up to 0.3.3 were signed unlisted and updated from `cristianbagrin/atpeaceupdates`. Its last entry
points those copies at the 0.5.0 file on addons.mozilla.org, which has no `update_url`, so Firefox updates
them from addons.mozilla.org from then on. Nothing new goes into `atpeaceupdates`. A file downloaded from
addons.mozilla.org (`latest.xpi`) updates the same way. `tools/check-release-setup.mjs` (without
`--mozilla-only`) and `tools/update-manifest.mjs` belong to the old route.
