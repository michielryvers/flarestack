# Package releases

The current `0.1.0-local.2` package set is a local preview. Generated applications
carry the exact NuGet/npm archives and root Bun dependency patches. There is no
claim that an archive-free registry template has been published or validated.

The repository uses the MIT license. NuGet metadata includes the license,
repository URL and license file. The npm manifest declares MIT and remains private
until the coordinated release is ready. Release builds copy the root license into
the npm archive before packing.

## Supported preview set

Use this complete pinned set together; independent upgrades are not covered by
this preview's acceptance results.

| Component | Tested version / contract |
| --- | --- |
| Flarestack.D1, Flarestack.Authentication, Flarestack.Email | `0.1.0-local.2` |
| Aspire.Hosting.Flarestack, @flarestack/alchemy, Flarestack.Templates | `0.1.0-local.2` |
| Private binding protocol | `2`; mismatches fail explicitly |
| .NET SDK / ASP.NET package references | `10.0.401` / `10.0.12` |
| Aspire CLI and hosting | `13.5.3`; experimental deployment adapter is isolated |
| Bun | `1.4.2` |
| Alchemy / Better Auth integration | `2.0.0-beta.79` with the bundled patches |
| Better Auth / OAuth provider | `1.7.5` |

The [validation matrix](validation.md) records platform coverage and limitations.
The older [compatibility investigation](compatibility.md) explains the upstream
constraints but is not the current support matrix.

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

## Release notes

Before tagging, move the completed entries in [CHANGELOG.md](../CHANGELOG.md)
from Unreleased into a dated version heading. Include public API migration links,
security/compatibility changes, executed acceptance results and known limitations.
Use that entry as the GitHub release body and retain an empty Unreleased heading.
Do not describe a configured CI job or an unrun cloud test as validated.

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

Resolve the upstream readiness-order, SQLite-startup and credential-free local
provider fixes before removing the patches. Then add and validate registry-based staging with no bundled archives,
including fresh restore, restart and migration acceptance. Do not publish a partial
package set as a supported starter experience merely to bypass these constraints.

## Symbols and Source Link

Each framework NuGet pack also produces a separate `.snupkg` containing its
portable PDB. The SDK embeds Source Link mappings without an additional runtime
or build package dependency. The template itself has no assembly and needs no
symbol package; preview templates continue to embed the same five runtime
archives, without embedding symbols.

The release workflow runs `scripts/verify-symbols.cs` against all four exact
package IDs and the tagged commit. It checks PDB/assembly identity, repository
Source Link mappings, and D1's shared protocol source. Checksums and uploaded
release artifacts include the four symbol packages. Publishing each `.nupkg`
with its adjacent `.snupkg` also sends the symbols to NuGet's symbol server;
the workflow deliberately does not use `--no-symbols`. Downloads are verified
against the recorded checksums before publication.

This is a verified packaging foundation, not evidence of a registry publication
or a remote debugger session. Local preview template consumers are unchanged.

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
