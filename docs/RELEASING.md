# Releasing Codex-Canvas

Codex-Canvas releases from a single `main` branch. Release Please maintains a
Release PR containing the next version and changelog. Merging that PR creates an
immutable `vX.Y.Z` tag and GitHub Release, then the release workflow tests and
uploads a platform-independent plugin package.

The first public release is intentionally bootstrapped as `v0.2.0`. It must be
newer than the legacy `0.1.1` installs so Codex creates a new versioned cache.
After that first Release PR is merged, Release Please owns all subsequent
versions.

## One-time repository setup

1. In **Settings → Actions → General**, enable **Allow GitHub Actions to create
   and approve pull requests**. The repository-wide default token permission
   can remain read-only because this workflow declares its own minimal write
   permissions.
2. Keep `main` as the default release branch.
3. Optionally add a `RELEASE_PLEASE_TOKEN` secret containing a fine-grained PAT
   with repository contents, pull-request, and issues write access (Release
   Please manages `autorelease:*` labels through the issues permission). Without
   it, the workflow uses `GITHUB_TOKEN`. GitHub does not start other workflows
   for pull requests created with `GITHUB_TOKEN`, so use the PAT when branch
   protection requires CI to run on the generated Release PR itself.

## Normal release flow

1. Merge normal development pull requests into `main`. Use Conventional Commit
   prefixes so the version bump is intentional:

   - `fix:` produces a patch release.
   - `feat:` produces a minor release.
   - `feat!:` or a `BREAKING CHANGE:` footer produces a major release.
   - `docs:`, `test:`, `build:`, and `chore:` are included where relevant but do
     not independently request a version bump.

2. The `Release` workflow creates or updates a Release PR. Review the proposed
   versions in `package.json`, `package-lock.json`,
   `.codex-plugin/plugin.json`, `.release-please-manifest.json`, and
   `CHANGELOG.md` together.
3. Merge the Release PR. Release Please creates the tag and GitHub Release in
   the same workflow run.
4. The release workflow checks out that exact tag and gates publication on the
   full macOS, Windows, and Linux / Node 18.18 and 22 test matrix. Only after the
   matrix passes does the Linux asset job build, install-smoke-test, and upload
   the universal archive.
5. Verify the GitHub Release has all three assets before announcing it:

   - `codex-canvas-vX.Y.Z.tgz`
   - `release-manifest.json`
   - `SHA256SUMS`

Do not create version tags manually during the normal flow. Do not merge a
Release PR whose CI is failing.

## Release artifact contract

Run the same builder locally with:

```sh
npm ci
npm test
node scripts/build-release.mjs --output-dir dist/release
```

The builder requires a clean Git checkout so the manifest commit always
identifies the exact packaged source. During local pipeline development only,
pass `--allow-dirty` to exercise the packager without creating a publishable
artifact.

The `.tgz` is an npm-format package that works on macOS and Windows. The release
manifest records the stable channel, tag, source commit, minimum Node.js range,
archive size, and SHA-256 digest. `SHA256SUMS` covers both the archive and the
manifest. The builder rejects version drift between `package.json`,
`package-lock.json`, and `.codex-plugin/plugin.json`.

The normal app uses one loopback server. If maintainers have manually started
additional servers on custom ports, close them before exercising an update so
only one process can run the Git/npm/Codex reinstall sequence. A server also
refuses to update while image, text, or chat operations are active.

## Repairing release assets

If a release was created but its asset job failed, fix the release workflow on
`main`, open **Actions → Release → Run workflow**, and enter the existing
`vX.Y.Z` tag. The workflow checks out that tag, rebuilds from the tagged source,
re-runs the tests, and replaces the three assets. It never moves or recreates
the tag.

If the tagged source itself is wrong, leave that release intact and publish a
new patch release. Never replace a published tag with another commit.
