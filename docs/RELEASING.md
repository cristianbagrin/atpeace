# Releasing At Peace

Mozilla signs each version privately (unlisted: no public page on addons.mozilla.org). The signed `.xpi` goes to a small public repo, `cristianbagrin/at-peace-updates`, together with `updates.json`. Zen and Firefox read that file once a day and update by themselves. The source repo, `cristianbagrin/at-peace`, stays private.

```
npm run release -- patch  ->  git push  ->  GitHub Actions: check, sign, publish  ->  Zen updates
```

## One-time setup (about 10 minutes, by you)

**1. The updates repo.** github.com, click **+** (top right), **New repository**. Owner `cristianbagrin`, name `at-peace-updates`, **Public**, tick **Add a README file**, **Create repository**. (The README makes the `main` branch exist; the workflow needs it.) Suggested README text: "Signed builds and update list for the At Peace browser extension. Nothing else is here."

**2. Mozilla API credentials.**
- Open https://addons.mozilla.org/developers/ and sign in with your Mozilla account. If it asks you to accept the Firefox Add-on Distribution Agreement, accept it; signing is refused until you do.
- Open https://addons.mozilla.org/developers/addon/api/key/ and click **Generate new credentials**.
- Keep the two values: **JWT issuer** (looks like `user:12345678:123`) and **JWT secret** (a long string). The secret is shown once.

**3. A GitHub token that can write to the updates repo only.**
- github.com, your profile picture (top right), **Settings**, then **Developer settings** (bottom of the left list), **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
- Token name `at-peace-updates`. Expiration: the longest offered (the token stops working then; see Troubleshooting). Resource owner: `cristianbagrin`.
- **Repository access**: **Only select repositories**, choose `at-peace-updates`.
- **Permissions**, **Repository permissions**, **Contents**: **Read and write**. Nothing else.
- **Generate token** and copy it. It is shown once.

**4. The secrets on the source repo.** github.com/cristianbagrin/at-peace, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Either one secret named `MOZILLA_GITHUB` holding all three values, one per line (labels such as `AMO_JWT_ISSUER:` in front are fine), or three secrets:

| Name | Value |
|---|---|
| `AMO_JWT_ISSUER` | the JWT issuer from step 2 |
| `AMO_JWT_SECRET` | the JWT secret from step 2 |
| `UPDATES_REPO_TOKEN` | the token from step 3 |

The values are told apart by their shape (`user:…`, 64 hex characters, `github_pat_…`); separate secrets win over `MOZILLA_GITHUB`. To check them without releasing anything: **Actions**, **Release setup check**, **Run workflow**. It asks Mozilla whether the key is accepted and checks the token can push, and never prints a value.

Then push this repo to `cristianbagrin/at-peace` as usual. The workflows live in `.github/workflows/`. **Actions** must be enabled for the repo (it is by default).

## First install in Zen

1. Wait for the first release run to finish (Actions tab, **Release**, green).
2. In Zen open `https://raw.githubusercontent.com/cristianbagrin/at-peace-updates/main/xpi/at-peace-<version>.xpi` (the newest file in the `xpi/` folder of `at-peace-updates`).
3. Zen asks to add At Peace. Click **Add**. Done.

If Zen downloads the file instead of asking, open `about:addons`, click the gear, **Install Add-on From File...** and pick the downloaded file. The same file is kept on each release run's page in the source repo (**Actions**, **Release**, the run, **Artifacts**).

From then on Zen checks for updates itself, about once a day. To check now: `about:addons`, the gear, **Check for Updates**. A version installed before this (a temporary add-on, or an unsigned build) has no update address; install the first signed one once, over it.

## Shipping an update (what Claude does)

After each release Claude also gives the user the built zip and the version notes (see `CLAUDE.md`), so the user can upload it to the store.

1. Make the change. Add a line about it under `## Unreleased` in `CHANGELOG.md` (the release is refused without one). Commit.
2. `npm run release -- patch`. Use `minor` for new settings or features, `major` for a break, or an exact `x.y.z`. It refuses on a dirty tree, runs lint, unit tests and `verify:package`, raises the version in `manifest.json`, `package.json` and `package-lock.json`, turns `Unreleased` into `## x.y.z — date`, and makes the commit `Release x.y.z`. It pushes nothing. `-- patch --dry-run` shows what it would do without changing anything.
3. `git push`. That publishes it, fully automatic: **Release** (github.com/cristianbagrin/at-peace, **Actions**) sees that `manifest.json` holds a version that the public `updates.json` does not list yet, set by a `Release x.y.z` commit, and takes a few minutes:
   - checks the versions agree and that the extension files are exactly those of the `Release x.y.z` commit, runs lint, tests and `verify:package`;
   - checks it can write to the updates repo (before Mozilla is involved);
   - `web-ext sign --channel=unlisted` (waits up to 10 minutes for validation and 25 for approval); if Mozilla already signed this version in an earlier run, it downloads that file instead;
   - adds `xpi/at-peace-<version>.xpi` to `at-peace-updates` and rewrites `updates.json`;
   - checks that the two public URLs serve the new files.
4. Zen picks up the new version within a day, or at once with **Check for Updates**.

Never change the add-on id (`at-peace@cristianbagrin`): the signature and every user's settings are tied to it. A version number is used up once Mozilla has signed it; it only ever goes up.

GitHub Actions on a private repo uses the monthly free minutes of the account. A check run is about 1 to 2 minutes, a release about 3 to 8.

## Troubleshooting

**Signing rejected (validation errors).** The **Sign with Mozilla** step prints Mozilla's messages (a code, a file, a line). Fix the cause, commit, and release again with `npm run release -- patch`. Mozilla may count the number as used; the skipped version number does no harm. `npm run lint` runs `web-ext lint --self-hosted`, which is what Mozilla applies to unlisted add-ons. Plain `web-ext lint` also reports `MANIFEST_UPDATE_URL`; that error is expected, because `update_url` is only allowed when self-distributing. It must be signed with `--channel=unlisted`.

**Signed, but not published** (the signing step is green, a later step is red). Fix the cause if it is on this side (for example the token, below), then open the run and **Re-run all jobs**. Mozilla does not sign a version twice, so the run downloads the file it already signed and carries on. The signed file is also kept on the run's page (**Artifacts**, `at-peace-<version>-signed`).

**"Waiting for Mozilla" or timed out waiting for approval.** The submission is at Mozilla but not signed yet. Re-run the job later; once Mozilla has signed it, the run downloads that file and publishes it. (https://addons.mozilla.org/developers/addons, **At Peace**, shows the version's state.)

**"Cannot push to the updates repo", "Cannot read the updates repo", or a 401/403 from GitHub.** The token expired, was deleted, or lacks **Contents: Read and write** on `at-peace-updates`. Make a new token (step 3), then **Settings**, **Secrets and variables**, **Actions**, the secret that holds it (`MOZILLA_GITHUB` or `UPDATES_REPO_TOKEN`), the pencil, paste, **Update secret**. Then open the failed run and **Re-run all jobs**.

**A 401 from Mozilla, or "refused by addons.mozilla.org".** The API credentials were revoked. Generate new ones (step 2) and put them in the secret (step 4).

**"Missing: ..." in Check the secrets exist.** A credential was not found in any of the secrets; add it (step 4). Run **Release setup check** to see what each secret holds.

**The last step says the files are not public.** Is `at-peace-updates` public? `raw.githubusercontent.com` can lag a few minutes; the step already waits 5 minutes. Re-run the failed job if it was only a delay.

**Zen does not update.** Check `https://raw.githubusercontent.com/cristianbagrin/at-peace-updates/main/updates.json` in a browser: the new version must be listed last. In `about:addons`, click At Peace: **Automatic Updates** must be **Default** or **On**. The gear's **Check for Updates** forces a check.

## Good to know

- The signed `.xpi` is the plain JavaScript of the extension, in a public repo: anyone who finds it can read it. [LICENSE](../LICENSE) (all rights reserved) still applies.
- Without GitHub Actions you can sign by hand: `WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign` writes the signed file to `web-ext-artifacts/`; then add it to `at-peace-updates` as in "Signed, but not published".
- `updates.json` lists every release, oldest first; Firefox takes the newest one it can install. Each entry carries the file's SHA-256, which Firefox checks before installing.
