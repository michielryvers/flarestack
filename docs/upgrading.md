# Local configuration and upgrades

Run `bun run doctor` to check the local configuration, required tools and package
inputs. Set `Flarestack__LocalMode=Container` to include the Docker daemon check.

To allocate eight consecutive ports to this app, stop it and run:

```sh
bun run configure:local --port 9000
aspire run
```

This writes gitignored `local.machine.json`, leaving committed defaults unchanged: application, private D1/
auth/email bridge, local inbox, Docker OTLP relay, dashboard, OTLP HTTP/gRPC and
Aspire resource service. The AppHost and container derive the auth authority from
the public origin. For containers, the supervisor writes this value only into
the staged development settings: Alchemy rewrites loopback URLs in environment
variables, which must not change the public OIDC issuer. Browser tests read `local.json`; `PUBLIC_ORIGIN` can override
it. Authentication cookies are namespaced by OAuth client ID. Use a different port block, OAuth client ID and app/stack name for each concurrent app. The
configuration command detects socket conflicts before writing. Identical settings are
a no-op even while running; changing ports requires a restart for listeners and OIDC
redirects. Fixed ports currently keep the Alchemy origin and issuer stable.

For standalone dashboard telemetry verification, set `FLARESTACK_DASHBOARD_URL`
to the chosen dashboard address. AppHost verification discovers its dashboard
through the Aspire CLI.

## Version policy

This remains a local preview (`0.1.0-local.2`), with pinned dependencies. Framework
NuGet packages, the npm runtime and template form one tested set; upgrade them
together. The template bundles the exact package artifacts and Alchemy patch.
Re-running a template over an existing application is not an upgrade procedure.

Before upgrading, stop the AppHost and back up the application's `infra/.alchemy`
state, including D1 data and auth signing keys. Preserve the stack name, resource
IDs and OAuth client ID. Changing identities may create new resources instead of
upgrading existing ones. Test migrations against a copy before using important
data. There is no automatic down-migration: rolling back package bytes alone does
not roll back schema changes.

In this repository, `bun run prepare:local` rebuilds the tested package set and
refreshes its private cache. In a generated app, replace the bundled packages with
one tested set, update its package references/lockfile, and refresh only the changed
local-preview package directories in its private `.packages/nuget` cache. Check
release notes for schema or cookie/session changes and expect reauthentication
when session contracts change. Keep `patches/` while using the pinned Alchemy
version; both resource readiness and local Worker startup need the bundled fixes. Immutable published versions and cloud deployment remain future work.


## Preview 1 → preview 2

Release identity is recorded in repository `version.json`; preparation checks all
package pins/contracts. Preview 2 uses private protocol 2. D1, auth, email and the
hosting/runtime contract reject mismatches with an actionable error. Native browser
Better Auth routes remain standard HTTP APIs. Keep all NuGet packages, npm tarball,
infrastructure metadata and template on the same release.

Breaking preview changes: use `IFlarestackEmailSender` and its receipt; remove the
actor argument from administration and use `UserRole`; inject `ICurrentUser` into
repositories; remove `builder.Environment` from auth registration; configure account
endpoints with `options.DefaultReturnPath`; replace runtime-path hosting arguments
with the infra directory and declared scripts. Move bootstrap IDs to environment
configuration. See [API examples](public-api.md).

`bun run test:acceptance` exercises packed artifacts in a fresh directory with an
isolated CLI home and Bun cache. Set `FLARESTACK_UPGRADE_FROM` to an older packed
template to test a disposable starter upgrade while preserving D1 state, then add
a migration and restart twice. This test replaces only its disposable starter code;
it is not an upgrade tool for user applications.
