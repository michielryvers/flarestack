# Flarestack

.NET 10 Interactive Server Blazor, Better Auth OIDC, Cloudflare Workers/Containers,
and D1. The Todo sample uses `Flarestack.Authentication`, `Flarestack.D1`, and
`Aspire.Hosting.Flarestack`. Everything currently runs locally; nothing has been
deployed or published to Cloudflare.

## Run

Prerequisites: .NET SDK **10.0.401**, Bun **1.4.2**, Aspire CLI **13.5.3**. Docker
is required for container mode. Versions are pinned in `global.json`, `mise.toml`,
and the package manifests. If using mise, run `mise install` first. With mise
shell integration disabled, prefix commands with `mise exec --`.

```sh
bun install --frozen-lockfile
bun run prepare:local
aspire run
```

Open [Todo at localhost:8787](http://localhost:8787). Select **Open my workspace**,
then **Create a new account**. Use this exact browser origin for OIDC redirects.
The Aspire dashboard is at [127.0.0.1:18888](http://127.0.0.1:18888); Aspire prints
its dashboard login link on startup. OTLP receivers require Aspire's generated
API key, which the AppHost passes to exporters.

Fast mode is the default. Aspire runs:

- **cloudflare**: the Bun adapter that supervises Alchemy, collects local process
  logs. Alchemy owns D1, migrations,
  Better Auth, and the edge Worker.
- **todo**: a supervised `dotnet watch` process. Razor/C# edits are applied through
  the .NET hot-reload workflow; unsupported edits restart the .NET app. The Worker
  forwards browser traffic, including Blazor WebSockets, to this process.

Fast mode uses an additional loopback Worker on port 8789 for the internal D1/auth
bridge. A per-run secret parameter protects it. The browser-facing Worker never
routes public SQL requests to that bridge. Both modes execute the same D1 protocol
against the same persisted local database.

Ctrl+C stops the AppHost and its resources. For background development:

```sh
aspire start
aspire wait cloudflare
aspire wait todo
aspire resource todo restart
aspire stop
```

`bun run dev` is an alias for `aspire run`. AppHost edits require an AppHost restart;
ordinary Todo edits are handled by `dotnet watch` without rebuilding Alchemy.

## Container mode

```sh
Flarestack__LocalMode=Container aspire run
```

Only `cloudflare` runs under Aspire in this mode. Alchemy starts the .NET Docker
container; there is no competing host Todo process. The container uses the real
`d1.internal` / `auth.internal` outbound handlers. Docker must reach services on
its host bridge, including workerd's dynamic outbound port and the OTLP relay on
`172.17.0.1:4319`. The relay forwards telemetry with Aspire's API key.

The supervisor stages a clean Docker build context under `.alchemy/todo-build`
to avoid the pinned Alchemy watcher's self-triggering restart bug. Restart the
AppHost after .NET edits in container mode. Fast mode is the hot-reload workflow.

D1 and provider data persist under `samples/Todo/infra/.alchemy/` across
mode changes and restarts. Replacing a container can require a fresh ASP.NET login;
accounts and todos remain. Logout clears the app cookie and invokes the provider's
confirmation page. App and provider cookies are distinct by design.

## Verify

```sh
bun run check
bun run test
dotnet test Flarestack.slnx
# With Aspire fast mode running:
bun run test:e2e
bun run test:hot-reload
bun run verify:telemetry
# With Aspire container mode running:
bun run test:e2e:container
FLARESTACK_TEST_MODE=Container bun run verify:telemetry
```

The browser test uses Chromium at `/usr/bin/chromium`; override `CHROMIUM_PATH`
as needed. It covers signup/OIDC, Blazor WebSockets, D1 CRUD, two-user isolation,
app restart persistence, and logout. The opt-in hot-reload test temporarily edits
and restores `Home.razor` and checks the changed output through the Worker.

## Observability

ServiceDefaults exports ASP.NET, HttpClient, Todo operation and D1 client spans.
Worker/D1/auth-backchannel spans preserve W3C trace context across process
boundaries. Fast-mode native telemetry attaches to Aspire's `todo` resource;
container telemetry uses `flarestack.todo`. The host collector also captures
Alchemy, auth/edge Workers, build/watch output, and container/proxy startup errors.
Metrics are not configured.

The Todo sample enables SQL text in Development. In Aspire, open a `D1 query`,
`D1 execute`, or `D1 batch` span and inspect `db.query.text`. The framework setting
`Flarestack:D1:IncludeSqlInTraces` defaults to false. Bound parameter values are
never attached; use placeholders because literals in SQL text remain visible.
Batch statements appear together, and SQL text is capped at 16,384 characters
plus a truncation marker.

```sh
aspire otel traces --non-interactive
aspire otel logs --non-interactive
```

`bun run dev:standalone` retains the earlier standalone dashboard/container workflow
for diagnosis. To verify it, use
`FLARESTACK_STANDALONE=1 FLARESTACK_TEST_MODE=Container bun run verify:telemetry`.
Do not run standalone and AppHost workflows simultaneously: they use the same
local ports and state. Raw Alchemy bypasses telemetry collection.

## Scope

Local Aspire orchestration, fast mode and container fidelity mode are implemented.
The hosting package uses Aspire executable resources, with endpoints, health checks, dependencies and standard resource
commands. Templates, production authentication hardening,
cloud secrets/state verification, and deployment integration remain future work.

## Framework and sample boundary

`src/alchemy` owns `FlarestackApp`, `createAuthWorker`, OAuth provisioning, edge
routing, internal bridges, container outbound handlers, and tracing. Its `local`
directory owns process supervision, log collection, build staging and .NET watch.
Framework code does not import the sample or the compatibility spikes.

`samples/Todo/infra` declares the database/migrations, OAuth client identity and
container environment, then calls `FlarestackApp`. Its Worker entrypoints are thin
exports of framework implementations. `samples/Todo/local.json` supplies paths,
ports, stack name, build inputs and an optional preparation command; paths are
relative to that file, and build inputs are relative to `buildRoot`.

The AppHost calls `AddFlarestack` with a `FlarestackOptions` configuration file,
runtime directory, mode and application resource name. The returned `Platform`
and optional `Application` builders allow further Aspire configuration. Container
mode returns no host application resource. Apps expose `/health` and use the
standard Flarestack account routes and OIDC callback paths.

The sample consumes locally packed NuGet packages and an npm tarball; templates
are the next step.
The legacy stack name `flarestack-compatibility` and resource IDs remain stable to
preserve state. For an existing checkout, stop Aspire and move
`spikes/compatibility/infra/.alchemy` to `samples/Todo/infra/.alchemy` **before**
starting the new layout. Do not overwrite a destination that already contains
state. Fresh checkouts need no migration. `spikes/compatibility` now contains only
the historical .NET probe, Dockerfile, smoke test and narrow D1 protocol test.
See [compatibility notes](docs/compatibility.md) and the
[implementation brief](flarestack-implementation-brief.md).

## Local packages

`bun run prepare:local` builds the authentication browser asset, packs
`Flarestack.D1`, `Flarestack.Authentication`, and `Aspire.Hosting.Flarestack` into
`artifacts/nuget`, packs `@flarestack/alchemy` into `artifacts/npm`, installs the
sample's tarball dependency, and restores the solution. All four packages use
`0.1.0-local.1`. Nothing is published.

The sample and AppHost use NuGet `PackageReference`s. Infrastructure imports
`@flarestack/alchemy`, and Aspire starts the supervisor/watch scripts from the
sample's installed package. Docker stages the local NuGet feed with the sample;
framework source directories are not part of that build context. The authentication
package carries its `_content/Flarestack.Authentication/sign-in.js` browser asset.

After editing framework code, stop Aspire, run `bun run prepare:local`, then start
Aspire again. Ordinary Todo edits still use hot reload. Preparation rejects a
running AppHost and refreshes only the repository's own local-preview NuGet cache
plus the sample tarball installation. NuGet's cache is isolated in `.packages/nuget`.
The bootstrap dependency install uses the root lockfile; the sample has its own
lockfile, refreshed when packing changes the tarball.

Package preparation precedes the AppHost, so it uses a temporary Aspire dashboard
on `127.0.0.1:18889` with OTLP HTTP on port 4320. Build/install logs are exported
there and the dashboard shuts down when preparation finishes. To retain them in
an existing receiver, set `OTEL_EXPORTER_OTLP_ENDPOINT` (and headers if needed).

This is a local preview with pinned dependencies. Keep the NuGet versions in
`Directory.Packages.props` and `src/Directory.Build.props` aligned with the npm
manifest and tarball paths when changing the preview version. Published immutable
versions, a license decision, a release policy and templates remain separate work.
