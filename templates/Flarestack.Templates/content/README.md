# FlarestackTemplate

A .NET 10 Blazor Web App using Interactive Auto for Todo and Interactive Server for account/admin pages with Better Auth OIDC, D1, and Aspire.
The generated app includes versioned local framework packages; it does not need
access to the Flarestack source repository. See [Interactive Auto](docs/interactive-auto.md)
for the client/server split, authenticated HTTP endpoints and rendering behavior.

## Run locally

Prerequisites: .NET SDK 10.0.401, Bun 1.4.2 and Aspire CLI 13.5.3. Docker is required
only for container mode. If using mise, trust the generated configuration and run
`mise install`. Otherwise ensure the pinned SDK is on PATH.

```sh
bun install --frozen-lockfile
aspire run
```

Open http://localhost:8787 and choose **Open my workspace**, then create an account. Open the **inbox** endpoint in Aspire to verify your email,
then sign in.
Aspire prints its dashboard login link (http://127.0.0.1:18888). Its logs and traces
include D1 SQL text in Development, without bound parameter values. Metrics are
not configured. Use `aspire start`, `aspire wait app` and `aspire stop` for a
background session. Razor/C# edits use hot reload in this default fast mode.

To run another app alongside this one, stop it and use
`bun run configure:local --port 9000` to assign eight consecutive ports. Auth
origins and browser tests follow the gitignored `local.machine.json` override;
committed defaults remain unchanged. Identical settings are a no-op. `bun run doctor` checks tools
and local configuration. See [configuration and upgrades](docs/upgrading.md).

Account recovery, profile/password settings, session management, and user
administration are included. See [accounts and email](docs/accounts-and-email.md)
for the first-admin setup through `FLARESTACK_ADMIN_USER_IDS` and the .NET APIs.
No default admin is created. See [session/security semantics](docs/security-model.md).

## Container mode

Stop fast mode first, then run:

```sh
Flarestack__LocalMode=Container aspire run
```

Alchemy owns the container; Aspire does not launch a second host app. Docker must
reach its host bridge, including workerd's outbound listener and OTLP relay at
172.17.0.1:4319. Restart the AppHost after source changes in container mode.
D1 accounts and tasks persist in `infra/.alchemy` across restarts and mode changes.
This generated application has its own stack identity (`app-TemplateSlug`), state,
and user-secrets ID. No credentials or accounts are included in the template.

## Verify

With the app running:

```sh
bun run test:e2e
bun run test:hot-reload
bun run verify:telemetry
```

Browser tests expect Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` to override.
For container mode, run `bun run test:e2e:container`, then
`FLARESTACK_TEST_MODE=Container bun run verify:telemetry`.

Framework packages are under `artifacts/nuget` and `artifacts/npm` and should be
kept with this project during the local preview. NuGet's cache is `.packages/nuget`.
Keep `patches/` too: the pinned Alchemy preview needs its bundled readiness fix
when applying migrations to an existing database. Bun applies it during install.
Update all Flarestack packages together when upgrading. This starter does not
publish packages or deploy to Cloudflare. Production auth hardening and deployment
configuration are separate work.
