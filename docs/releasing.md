# Releasing

`conva_app` (this repo) is the **private** source. Installers, the updater's
`latest.json`, and public release notes are published to the **public**
[`atomicapps-ai/conva_releases`](https://github.com/atomicapps-ai/conva_releases)
repo instead — never to this repo's own Releases page. See
[`../CLAUDE.md`](../CLAUDE.md) and
`conva_core/docs/technical/CONVA_SDLC_RELEASE_STRATEGY.md` for the full SDLC
this checklist implements.

## Required secrets (names only — set as `conva_app` → Settings → Secrets → Actions)

| Secret | Used for | Required? |
|---|---|---|
| `CONVA_ENV_KEY` | The env-toolkit master key (`env/README.md`) — unlocks the committed `.env.<env>.sec.enc` files, which is where `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` actually live now. `build-installers.yml` decrypts straight into `$GITHUB_ENV` before the build step; nothing is ever printed to the log. | Optional — without it, plain installers still build, only update artifacts + `latest.json` are skipped (same fallback the old direct secrets gave) |
| `RELEASES_REPO_TOKEN` | Fine-grained GitHub PAT scoped to **only** `atomicapps-ai/conva_releases`, permission **Contents: Read and write** — lets the release build attach installers + `latest.json` to a release in that repo instead of this one | Required for a tagged release run to actually publish; a run without it fails loudly at the "Build installers" step with a GitHub API auth error (it never silently falls back to drafting in the wrong, private repo) |

`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are **no
longer set directly as GitHub secrets** — as of the v0.3.1 release attempt,
this repo's `TAURI_SIGNING_PRIVATE_KEY` secret held a malformed value (base64
that didn't decode to a valid minisign box), which killed both installer jobs
at the very last step, signing, after a full successful build. The direct-secret
path made that easy to get wrong with no way to verify the value once pasted
(GitHub secrets are write-only). Routing it through the env toolkit instead
means the actual key lives in a committed, readable-by-anyone-with-the-master-key
file — one `CONVA_ENV_KEY` paste unlocks it, and every future rotation is
`edit .env.<env>.sec` → `npm run env:encrypt:<env>` → commit, never a return
trip to the GitHub UI.

That paste must be **this repo's** master key (`conva_app/env/master.key`).
`conva_web` has a separate one; they are not interchangeable, and the committed
`.enc` files must have been encrypted with whichever key GitHub currently holds
— `keygen` overwrites `master.key`, orphaning every `.enc` older than it. The
decrypt step fails the build loudly on a mismatch rather than silently producing
unsigned installers, and its error names both remedies.

### Generating the signing keypair (only needed once, or to rotate)

```
npx tauri signer generate -w ~/.tauri/conva.key
```

Prompts for a password (empty is fine — CI doesn't need one). Paste the
printed **private key** into `TAURI_SIGNING_PRIVATE_KEY=` in both
`.env.dev.sec` and `.env.prod.sec` (same keypair in both — the `pubkey` in
`src-tauri/tauri.conf.json` is fixed, so the private key must match across
envs) and the password into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=` in both.
Then:

```
npm run env:encrypt:dev
npm run env:encrypt:prod
```

commits the encrypted `.env.dev.sec.enc` / `.env.prod.sec.enc` twins (see
`env/README.md` for the full model). **Rotating the key also means updating
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`** to the newly
printed public key (that value is the whole `.pub` file's base64 content,
pasted verbatim — no re-encoding) and cutting a new version, since existing
installs verify updates against the old pubkey and would reject anything
signed by a new key without it.

Never commit a secret value anywhere in this repo — see
[`ai-workflow.md`](ai-workflow.md).

## SemVer rules

Versioning is `MAJOR.MINOR.PATCH[-alpha\|beta\|rc.N]` (enforced by the regex
in `scripts/version.mjs`). The **git tag `vX.Y.Z` is the source of truth**;
`package.json` / `Cargo.toml` / `tauri.conf.json` are its mirrors, kept in
sync only by `scripts/version.mjs` (never hand-edit them).

There is no automatic bump — before cutting a release, read the
Conventional-Commit log since the last tag (`git log <last-tag>..HEAD
--oneline`, or `git-cliff --unreleased` for the grouped view) and pick the
next version by the highest-impact commit type present:

| Commit type(s) since last tag | Bump |
|---|---|
| Any `feat!:` / `BREAKING CHANGE:` footer | **MAJOR** |
| `feat:` (no breaking marker) | **MINOR** |
| `fix:` / `perf:` / `refactor:` only | **PATCH** |
| Only `docs:`/`chore:`/`ci:`/`build:`/`test:`/`style:` | No user-facing release needed (these are dropped from release notes) |
| Beta/RC line | `X.Y.Z-beta.N` / `-rc.N` — only via `dev-build.yml`'s automatic beta stamping, never hand-tagged |

CI enforces the mechanics that make this reliable, not the bump choice
itself: every PR title must be a Conventional Commit (`ci.yml`
"PR title is a Conventional Commit"), and the version-guard job on release
refuses to build if the tag doesn't match `package.json`.

## Release checklist

1. **On `main`, decide the version** per the SemVer table above, then:
   ```
   npm run version:set <X.Y.Z>
   git add -A && git commit -m "chore(release): vX.Y.Z"
   git push
   ```
2. **Tag and push** — this is what triggers everything:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. **Watch the `Release` workflow** (`.github/workflows/release.yml`):
   - `version-guard` fails fast if the tag ≠ `package.json` version, and
     generates the user-facing notes from Conventional Commits via git-cliff.
   - `build` (the reusable `build-installers.yml`) builds Windows
     (MSI + NSIS, Vulkan) and macOS (dmg, Metal) on GitHub-hosted runners,
     signs updater artifacts (if the signing secrets are set), and opens a
     **draft** Release in `atomicapps-ai/conva_releases` with those notes.
4. **Review the draft** at
   https://github.com/atomicapps-ai/conva_releases/releases — check both
   platforms' assets are attached, notes read correctly, then **publish**
   it. The updater feed (`.../releases/latest/download/latest.json`) only
   resolves once a release is published, not while draft.
5. **Regenerate the local changelog + in-app release notes** (these are not
   yet wired into CI — do them by hand on the release branch/commit):
   ```
   npm run changelog:generate    # git-cliff -o CHANGELOG.md — needs the git-cliff binary on PATH
   ```
   and add the matching entry to `src/lib/releases.ts` (the in-app
   "What's New" view) with an owner-edited `summary` line.
   `npm run changelog:preview` (`git-cliff --unreleased`) previews the notes
   for commits since the last tag without writing the file — useful while
   deciding the version in step 1.
6. **Update `conva_core/docs/product/roadmap.md`** in the same pass if this
   release changes priorities or closes a roadmap item (per that repo's
   CLAUDE.md).

Beta builds (push to `dev`) go through the same `build-installers.yml` matrix
via `dev-build.yml`, but with `release: false` — they upload as workflow
artifacts only, never touch `conva_releases`, and need none of the secrets
above except the signing ones (optional there too).

## Cross-repo publishing — the `target_commitish` trap

The installers build in `conva_app` but the Release is created in
`atomicapps-ai/conva_releases`. Those are different repositories, and GitHub
validates the new release's `target_commitish` **against the target repo**.

`tauri-action` defaults `releaseCommitish` to the SHA of the current commit —
a `conva_app` SHA, which does not exist in `conva_releases`. The result is a
failure at the very last step, *after* a complete, successful, signed build:

```
Finished 2 bundles at: .../conva_0.3.3_aarch64.dmg
Finished 1 updater signature at: .../conva.app.tar.gz.sig
Looking for a draft release with tag v0.3.3...
Couldn't find release with tag v0.3.3. Creating one.
##[error]Validation Failed: {"resource":"Release","code":"invalid","field":"target_commitish"}
```

That is v0.3.3, run
[33925551829](https://github.com/atomicapps-ai/conva_app/actions/runs/33925551829)
— roughly 10 minutes of build thrown away at the publish call, which is
exactly the shape of the earlier signing-key failure and just as misleading:
the logs read as a successful build right up to the last line.

The fix is `releaseCommitish: main` (`RELEASES_REPO_BRANCH` in
`build-installers.yml`), pinning it to the default branch of
`conva_releases`. It is only consulted when the tag does not already exist
there; notes and artifacts still come from this repo's tag. **If
`conva_releases` ever renames its default branch, update that env var** —
nothing else references it, and the failure would look like an unrelated
build break.

## Rollback

The updater always resolves `conva_releases`' **latest published** (not
draft, not prerelease) release — GitHub picks that automatically by publish
time unless one is pinned. If a published release turns out to be bad:

1. **Stop new installs/updates immediately:** in `conva_releases`, either
   delete/unpublish the bad release (GitHub recomputes "latest" to the prior
   good one), or open the prior good release and use "Edit release" →
   mark it as the latest release explicitly. Do this first — it's the fast,
   low-risk step and takes effect for anyone who hasn't updated yet.
2. **Ship a fixed patch release right after**, same checklist as above, one
   PATCH version above the bad one (e.g. bad `v0.3.0` → fix ships as
   `v0.3.1`). This is the step that reaches anyone who already downloaded
   and installed the bad build — deleting a release does not uninstall
   anything, only a newer signed update does. Never re-use the bad tag
   number for the fix.
3. If the bad tag was pushed to `conva_app` and the build never got as far
   as a published release (caught in review at step 4 above), it's enough
   to delete the draft in `conva_releases` and delete the local + remote git
   tag (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`) — no user
   was ever exposed.
