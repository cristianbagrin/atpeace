# At Peace

A calm, intentional YouTube. At Peace is a Firefox / Zen Browser extension that lets you hide the
parts of YouTube you don't want to see, and puts a little friction (a breath, a timer, a schedule)
between you and the feed. Everything runs locally: nothing ever leaves the browser, there is no
analytics and no remote code. The full design lives in [`docs/PLAN.md`](docs/PLAN.md).

> Status: early development (Phase 0, the foundation). The extension loads and the plumbing is
> tested, but the features arrive in later phases.

## Development

Requirements: Node.js 22 or newer. No build step: what is in `src/` is what ships.

```sh
npm install
npm run lint     # eslint + web-ext lint
npm test         # unit tests (node:test)
npm run e2e      # extension smoke test in Chromium (Playwright library, preinstalled)
npm run test:firefox   # the same smoke test in real headless Firefox (Selenium + geckodriver)
```

| script | does |
|---|---|
| `npm run lint` | `eslint .` and `web-ext lint --self-hosted` |
| `npm test` | unit tests in `tests/unit/` |
| `npm run e2e` | Chromium E2E in `tests/e2e/` (screenshots land in `tests/e2e/artifacts/`) |
| `npm run test:firefox` | downloads Firefox + geckodriver into `~/.cache/at-peace/` on first run, then runs `tests/firefox/smoke.mjs` |
| `npm run selectors` | live selector coverage report (added in a later phase) |
| `npm run start:firefox` | `web-ext run`: opens a throwaway Firefox profile with the extension loaded (`-- --firefox=/path/to/zen` to use another browser) |
| `npm run build` | `web-ext build`: `web-ext-artifacts/at-peace-<version>.zip` |
| `npm run sign` | `web-ext sign --channel=unlisted` (see below) |

The PNG icons are generated from `icons/icon.svg` with `node tools/make-icons.mjs`.

## Try it in Zen (or Firefox)

1. Open `about:debugging` and choose **This Firefox** (in Zen: the same page).
2. Click **Load Temporary Add-on…** and pick this folder's `manifest.json`.
3. Open https://www.youtube.com/.

A temporary add-on disappears when the browser restarts. Reload it from the same page after editing
the code.

## Installing permanently

Zen, like Firefox release, only keeps *signed* add-ons. Signing is free through the unlisted channel
on addons.mozilla.org, but it needs your own Mozilla account and API keys, so it is a step only you can do:

```sh
export WEB_EXT_API_KEY=...      # from https://addons.mozilla.org/developers/addon/api/key/
export WEB_EXT_API_SECRET=...
npm run sign
```

This writes a signed `.xpi` into `web-ext-artifacts/`. Drag it into Zen to install it.
