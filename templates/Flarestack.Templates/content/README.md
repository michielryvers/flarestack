# FlarestackTemplate

A .NET 10 Blazor Web App with Interactive Auto Todo pages, server-rendered account
and administration pages, D1, Better Auth and Aspire logs/traces. This preview
includes packed Flarestack dependencies and does not require the framework repository.

## Run locally

Install .NET SDK 10.0.401, Bun 1.4.2 and Aspire CLI 13.5.3. Docker is needed only
for Container mode and cloud deployment. Then:

```sh
bun install
aspire run
```

Open the application endpoint in Aspire (default http://localhost:8787). Register
and open the **inbox** endpoint to verify your email. Aspire collects application,
Worker, database and infrastructure logs and traces. Development SQL spans omit
bound parameter values. No default administrator is created.

Fast mode uses .NET hot reload. To switch modes, stop the app first:

```sh
aspire stop
bun run dev:container
```

Alchemy owns the container; Aspire does not start a duplicate application.
Data persists in `infra/.alchemy` across local restarts and mode changes.
Use `aspire start`, `aspire wait app` and `aspire stop` for background Fast sessions;
`bun run dev:container --background` starts Container mode in the background.

## Deploy to staging or production

Install and start Docker, then connect an Alchemy Cloudflare profile:

```sh
cd infra
bunx alchemy profile edit --add cloudflare
cd ..
aspire deploy --environment staging
```

Review `deployment.json` first. An empty staging configuration uses workers.dev
and disables cloud email. Add a custom `domain` and `email` sender there when
needed. Cloud resources are billable. Stage names are explicit and lowercase;
repeating the command updates the same stage.

Production is preview-only: ASP.NET Data Protection keys do not survive container
replacement, so users may need to sign in again. Production settings must explicitly
acknowledge this with `allowEphemeralDataProtectionKeys: true` before running
`aspire deploy --environment production`. Keep one container instance.

See [deployment](docs/deployment.md) for credentials, stable state, configuration,
smoke checks and separate confirmed teardown. Never commit tokens or secret files.

## Configure accounts and services

Use the Aspire environment or your shell/CI's secret configuration for
`FLARESTACK_ADMIN_USER_IDS` (comma-separated Better Auth user IDs). Do not commit
personal IDs. See [accounts and email](docs/accounts-and-email.md) and
[security semantics](docs/security-model.md).

`FlarestackTemplate.Web/Program.cs` registers D1, authentication and email through
`builder.AddFlarestackD1()`, `builder.AddFlarestackAuthentication()` and
`builder.AddFlarestackEmail()`. Optional callbacks configure validated options.
The public interfaces remain injectable into application services.

## Change the application

- Add Razor pages under the Web project's `Components/Pages`, or client-capable
  pages in the Client project. Client code calls authenticated HTTP endpoints;
  it cannot use private D1 bindings directly.
- Add application services to dependency injection in `Program.cs`. Repository
  methods must obtain the current user internally and filter reads and writes by
  owner. Keep cross-user isolation tests when adding features.
- Add a new numbered SQL file under `migrations`. Restart locally or deploy to
  apply it. Never change a migration already applied to a shared stage.
- Keep infrastructure configuration in `infra/alchemy.run.ts`; Alchemy owns the
  resource graph. Preserve the private-route boundary, OIDC issuer and PKCE policy.
  See [infrastructure extensions](docs/infrastructure.md), [public APIs](docs/public-api.md)
  and [database access](docs/database.md).

## Test and troubleshoot

Browser tests also require Node.js 20 or later for the Playwright CLI. Normal
application startup uses Bun and does not require Node.js.

```sh
bunx playwright install chromium
bun run test:e2e
bun run verify:telemetry
```

For Container mode use `bun run test:e2e:container`. Browser tests use Playwright's
managed Chromium; `CHROMIUM_PATH` can override it. Hot reload tests apply to Fast mode.

Run `bun run doctor` for tool/configuration checks. If ports conflict, stop the app
and run `bun run configure:local --port 9000`; the command checks an eight-port
range and writes an idempotent, gitignored machine override. If Docker cannot reach
the host, inspect Aspire logs and your bridge/firewall settings. Docker Desktop uses
`host.docker.internal`; the authenticated OTLP relay supports Desktop and Linux.

Keep `artifacts/nuget`, `artifacts/npm` and `patches` with this local-packaged preview.
They are not a registry release. Upgrade Flarestack packages together; see
[compatibility](docs/api-migration.md). Do not delete `.alchemy` to repair a deployment:
that is provider state, not a disposable build cache.
