# Package releases

The current `0.1.0-local.2` package set is a local preview. Generated applications
carry the exact NuGet/npm archives and root Bun dependency patches. There is no
claim that an archive-free registry template has been published or validated.

The repository uses the MIT license. NuGet metadata includes the license,
repository URL and license file. The npm manifest declares MIT and remains private
until the coordinated release is ready. Release builds copy the root license into
the npm archive before packing.

## One coordinated version

`version.json` is the release identity; `bun scripts/check-versions.ts` verifies the
NuGet versions, central package references, npm runtime, Worker protocol, .NET
protocol and infrastructure contract. Update this complete set in one reviewed
change. Protocol compatibility and package versions are separate: do not change
the protocol solely to bump a package version.

A registry candidate must use a fresh SemVer such as `0.1.0-preview.1` and an exact
`v0.1.0-preview.1` Git tag. Local versions and build metadata are rejected. Protect
release tags against updates/deletion; never rebuild and overwrite a published
version. Local preview cache replacement in `prepare:local` is not a registry
release policy.

## Candidate workflow

The **Release candidate** workflow runs for version tags or manual dispatch on a
version tag. It verifies the identity, invokes Linux/Windows Fast and Linux
Container acceptance, then builds the coordinated artifacts with SHA-256 checksums.
The default is artifact retention only. No cloud resources are deployed or destroyed.

Manual `publish=true` is an additional opt-in. Before any publication, the workflow
requires `scripts/check-release.ts --registry` to pass. It currently fails because:

- The staged template bundles `artifacts/nuget` and `artifacts/npm`.
- The npm dependency points to a `file:` archive and NuGet uses a local feed.
- Bun root patches are required for the pinned Alchemy preview.
- The npm runtime remains private.

The registry-template validator rejects bundled package archives/local runtime
state, local dependency paths and root patch declarations. It requires the exact
coordinated npm version and HTTPS NuGet feeds. Runtime validation separately
rejects a private package and remaining repository patch requirements. Removing
only a template patch declaration cannot bypass the repository gate.

Resolve the upstream readiness-order and SQLite-startup fixes before removing the
patches. Then add and validate registry-based staging with no bundled archives,
including fresh restore, restart and migration acceptance. Do not publish a partial
package set as a supported starter experience merely to bypass these constraints.

## Publication environment

Before enabling publication, repository administrators must configure the GitHub
`package-publication` environment with required reviewers and release-tag-only
access, plus scoped `NPM_TOKEN` and `NUGET_API_KEY` secrets. The YAML references the
environment but cannot establish its reviewer/protection settings. No credentials
belong in source, workflow inputs, package contents or uploaded evidence.

After approval, the job downloads the built artifacts and checks their digests; it
does not rebuild them. It checks that both credentials exist, publishes the npm
runtime (`next` for prereleases), then the four framework NuGets and the template
last. Lifecycle scripts are disabled for npm publication. Duplicate versions fail;
there is no `--skip-duplicate` or automatic version overwrite.

Registries do not provide an atomic transaction across this set. A failure after
one upload requires maintainer investigation; do not silently substitute rebuilt
bytes or pretend the whole set published. Verify every registry version and its
content before announcing availability. Package publication and cloud deployment
are independent operations with separate authorization and evidence.
