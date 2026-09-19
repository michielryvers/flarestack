# Flarestack: .NET + Blazor on Cloudflare

> Implementation brief for an agent. Working name: **Flarestack**. Check NuGet/npm/GitHub name availability before publishing; renaming must not change the architecture.
>
> Baseline: .NET 10, Blazor Web App with Interactive Server, current stable Aspire, Bun, Alchemy, Cloudflare Workers/Containers/D1, Better Auth OAuth 2.1 Provider. APIs mentioned here reflect documentation checked on 2026-09-19; pin exact dependency versions in the first implementation commit.

## 1. Objective

Build a small, reusable framework that makes this application stack feel native to a .NET developer:

```text
Browser
  -> Cloudflare Worker
       -> Better Auth + OAuth/OIDC routes
       -> Blazor/.NET container for application routes
       -> D1 through an internal container outbound handler

Local orchestration: Aspire
Cloudflare infrastructure and deployment: Alchemy
Production runtime: Worker + Cloudflare Container + D1
```

The expected developer experience is:

```bash
aspire run
aspire deploy
```

Application code should use ordinary ASP.NET Core authentication and a deliberately small Dapper-like D1 abstraction. It must not import Better Auth, Cloudflare, Alchemy, or Worker-specific types.

The first end-to-end proof is an authenticated multi-user Todo application. Each user can create, list, complete, reopen, and delete only their own todos.

## 2. Non-goals for v0.1

- Do not build an ORM, LINQ provider, change tracker, or EF Core provider.
- Do not reproduce all Dapper features.
- Do not support stored procedures, multiple result sets, multi-mapping, or arbitrary object graphs.
- Do not expose an endpoint that accepts SQL from the public internet.
- Do not model D1, Worker, Container, and Better Auth as separate Aspire-owned infrastructure resources. Alchemy is the single source of truth for Cloudflare infrastructure.
- Do not add R2, KV, Queues, scheduled jobs, MCP, organizations, roles, or social providers until the core path works.
- Do not promise zero-downtime container scaling or multi-instance behavior in v0.1. Default to one logical container instance.

## 3. Architectural decisions

### 3.1 Ownership boundary

| Concern | Owner |
| --- | --- |
| Application/domain/UI | Blazor application |
| ASP.NET authentication state | ASP.NET Core cookie + OIDC handler |
| Identity, credentials, OAuth/OIDC | Better Auth in the Worker |
| SQL execution and D1 binding | Worker-side D1 bridge |
| Container lifecycle and Cloudflare resources | Alchemy |
| Local topology, dashboard, process lifecycle | Aspire |
| Production deployment command | Aspire deployment step invoking Alchemy |

Aspire must treat the Cloudflare stack as one logical resource. Alchemy remains the authoritative resource graph for D1, Better Auth, Worker, Container, routes, secrets, and migrations.

### 3.2 Authentication boundary

Better Auth is an OAuth 2.1 authorization server with OIDC enabled through the `openid` scope. Blazor is an OIDC relying party using standard ASP.NET Core handlers:

- Browser-facing login: Better Auth session and login UI.
- Blazor sign-in: Authorization Code flow with S256 PKCE.
- Blazor session: encrypted ASP.NET Core cookie.
- User identifier: OIDC `sub`; store it as `owner_id` in app tables.
- Logout: local ASP.NET cookie sign-out followed by the provider's end-session flow.

Do not parse or validate Better Auth's private session cookie in .NET.

For v0.1, provision Blazor as a first-party **public OAuth client** (`token_endpoint_auth_method = "none"`) using PKCE, exact redirect URI matching, and `skipConsent = true`. This avoids secret distribution while the deployment provisioner is being established. The server-side Blazor client can be upgraded to a confidential client later without changing application code.

### 3.3 D1 boundary

The .NET container has no direct Worker binding. It calls a virtual HTTP origin such as:

```text
http://d1.internal/v1/commands
```

Cloudflare's container outbound handler intercepts that hostname inside the Workers runtime and executes statements against the D1 binding. The bridge is never mounted in the public Worker's request router.

The same protocol must be used in local fidelity mode and production.

### 3.4 Database layout

Use one D1 database for v0.1:

- Better Auth owns its identity/OAuth tables and migrations.
- Alchemy applies numbered application migrations.
- Application tables use a neutral `owner_id TEXT NOT NULL` containing the OIDC `sub`.

Do not add a foreign key from `todo.owner_id` to Better Auth's user table in v0.1. That would couple application migrations to Better Auth's internal schema and migration order. Referential cleanup can be added through an explicit user-deletion hook later.

## 4. Repository layout

Create a monorepo resembling:

```text
flarestack/
├── Directory.Build.props
├── Directory.Packages.props
├── global.json
├── Flarestack.slnx
├── package.json
├── bun.lock
├── README.md
├── docs/
│   ├── architecture.md
│   ├── local-development.md
│   └── deployment.md
├── src/
│   ├── Flarestack.D1/
│   ├── Flarestack.Authentication/
│   ├── Aspire.Hosting.Flarestack/
│   └── alchemy/
│       ├── package.json
│       └── src/
│           ├── app.ts
│           ├── worker.ts
│           ├── auth.ts
│           ├── auth-client-provisioner.ts
│           ├── d1-bridge.ts
│           ├── container.ts
│           ├── protocol.ts
│           └── login-ui/
├── templates/
│   └── Flarestack.Templates/
├── samples/
│   └── Todo/
│       ├── Todo.AppHost/
│       ├── Todo.Web/
│       ├── Todo.ServiceDefaults/
│       ├── infra/
│       │   ├── alchemy.run.ts
│       │   └── package.json
│       ├── migrations/
│       │   └── 0001_todos.sql
│       └── Dockerfile
└── tests/
    ├── Flarestack.D1.Tests/
    ├── Flarestack.Authentication.Tests/
    ├── Aspire.Hosting.Flarestack.Tests/
    ├── Alchemy.Tests/
    └── Todo.EndToEndTests/
```

Use central package management. Enable nullable reference types, implicit usings, analyzers, deterministic builds, warnings as errors for framework projects, package README/license metadata, and Source Link.

## 5. Public packages

### 5.1 `Flarestack.D1`

Target `net10.0` initially. Keep the public API small:

```csharp
public interface ID1Database
{
    Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    Task<T?> QuerySingleOrDefaultAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    Task<int> ExecuteAsync(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<D1CommandResult>> BatchAsync(
        IReadOnlyList<D1Command> commands,
        CancellationToken cancellationToken = default);
}

public sealed record D1Command(
    string Sql,
    IReadOnlyList<object?> Parameters,
    D1CommandKind Kind = D1CommandKind.Execute);

public enum D1CommandKind
{
    Execute,
    Query
}

public sealed record D1CommandResult(
    int RowsAffected,
    IReadOnlyList<JsonElement>? Rows = null);
```

Also provide `params object?[]` convenience overloads as extension methods, but keep the interface unambiguous.

Registration:

```csharp
builder.Services.AddFlarestackD1(builder.Configuration);
```

Configuration:

```json
{
  "Flarestack": {
    "D1": {
      "BaseAddress": "http://d1.internal",
      "TimeoutSeconds": 30
    }
  }
}
```

Environment variable form:

```text
Flarestack__D1__BaseAddress=http://d1.internal
```

Implementation requirements:

- Use a named or typed `HttpClient` from `IHttpClientFactory`.
- Send a versioned discriminated protocol; do not expose transport DTOs publicly unless necessary.
- Use D1 numbered parameters (`?1`, `?2`, ...) in documentation and samples.
- Convert supported CLR parameter types explicitly: `null`, `string`, integral numbers, floating-point numbers, `bool` to `0/1`, `Guid` to canonical string, `DateTime`/`DateTimeOffset` to ISO-8601 UTC string, and `byte[]` to an explicitly tagged base64 value.
- Reject unsupported parameter types with a useful exception before sending.
- Deserialize rows with `System.Text.Json`; enable case-insensitive matching and snake_case naming so `created_at` maps to `CreatedAt`.
- Define behavior for zero/multiple rows. `QuerySingleOrDefaultAsync` returns null for zero and throws `D1CardinalityException` for more than one.
- Translate non-success bridge responses into a `D1Exception` containing a safe error code, operation, and correlation ID. SQL and parameter values should only be included when an opt-in diagnostics setting is enabled.
- Emit `ActivitySource` spans and `ILogger` events. Never log secrets or raw auth cookies.
- Respect cancellation and timeouts.
- Cap request sizes and command counts with configurable defaults.
- Treat D1 batch as the only v0.1 transaction-like primitive. Do not offer a fake `BeginTransaction` API.

Suggested application usage:

```csharp
public sealed class TodoRepository(ID1Database db)
{
    public Task<IReadOnlyList<TodoItem>> ListAsync(
        string ownerId,
        CancellationToken ct) =>
        db.QueryAsync<TodoItem>(
            """
            SELECT id, owner_id, title, is_complete, created_at
            FROM todo
            WHERE owner_id = ?1
            ORDER BY created_at DESC
            """,
            [ownerId],
            ct);

    public Task<int> AddAsync(TodoItem todo, CancellationToken ct) =>
        db.ExecuteAsync(
            """
            INSERT INTO todo(id, owner_id, title, is_complete, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            """,
            [todo.Id, todo.OwnerId, todo.Title, todo.IsComplete, todo.CreatedAt],
            ct);
}
```

### 5.2 `Flarestack.Authentication`

This package hides ASP.NET Core OIDC/cookie configuration and supplies reusable auth UI integration.

Public registration:

```csharp
builder.Services.AddFlarestackAuthentication(builder.Configuration);
```

Configuration:

```json
{
  "Flarestack": {
    "Authentication": {
      "Authority": "https://todo.example.com/auth",
      "ClientId": "todo-blazor",
      "Scopes": ["openid", "profile", "email"],
      "CallbackPath": "/signin-oidc",
      "SignedOutCallbackPath": "/signout-callback-oidc",
      "BackchannelBaseAddress": "http://auth.internal"
    }
  }
}
```

Required behavior:

- Default authenticate/sign-in scheme: secure ASP.NET cookie.
- Default challenge scheme: OpenID Connect.
- Authorization Code flow, `UsePkce = true`, no client secret in v0.1.
- `SaveTokens = false` unless a feature actually requires downstream tokens.
- Map `sub` to `ClaimTypes.NameIdentifier`, preserve raw `sub`, map name/email claims, and avoid broad inbound claim renaming beyond documented mappings.
- Cookie flags: `HttpOnly`, `Secure` in non-development environments, `SameSite=Lax`, sliding expiration with a documented lifetime.
- Configure forwarded headers correctly so redirects use the browser-facing Worker origin.
- Validate issuer, audience/client ID, lifetime, nonce, correlation, and state using the standard handler defaults. Do not disable HTTPS metadata outside explicit local development.
- Provide `/account/login`, `/account/logout`, and `/account/access-denied` endpoint mapping helpers, or document the minimal application endpoints.
- On login, challenge with a safe local return URL only.
- On logout, clear the local cookie and invoke OIDC sign-out/end-session.

The package must support a different browser-facing authority and container back-channel address. Implement a delegating handler that rewrites outbound discovery/token/UserInfo/end-session HTTP requests from the public authority origin to `BackchannelBaseAddress`, while retaining the public issuer for metadata and token validation. This is essential in local Docker mode, where `localhost` inside the container is not the host Worker.

Do not rewrite arbitrary hosts. Only rewrite when the outgoing URI origin exactly matches the configured public authority origin. Add tests for path/query preservation and SSRF resistance.

Login UI options:

1. The sample's Blazor `/account/sign-in` page is public.
2. A small prebuilt browser module, shipped as a static web asset, creates a Better Auth client with the OAuth Provider client plugin and performs email/password sign-in/sign-up against `/auth` on the same browser origin.
3. The Better Auth OAuth provider's `loginPage` points to `/account/sign-in`.
4. The browser module must preserve the signed `oauth_query` continuation. Prefer Better Auth's official client plugin instead of manually reconstructing OAuth query state.

The TypeScript browser asset may be built in the monorepo and packed into the Razor Class Library. Application authors must not need npm merely to consume the NuGet package.

### 5.3 `Aspire.Hosting.Flarestack`

This is an Aspire hosting integration, not a runtime dependency. Follow Aspire conventions:

- Custom `FlarestackResource : Resource` (or current equivalent implementing `IResource`).
- `AddFlarestack(...)` extension on `IDistributedApplicationBuilder`.
- Optional fluent `With*` methods.
- Resource appears in the Aspire dashboard with status, endpoint, logs, and useful commands.

Proposed public API:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var platform = builder.AddFlarestack(
        "cloudflare",
        workingDirectory: "../infra")
    .WithLocalMode(FlarestackLocalMode.Fast)
    .WithHttpEndpoint(port: 8787)
    .WithAlchemyCommand("bun", "alchemy", "dev")
    .WithDeploymentCommand("bun", "alchemy", "deploy");

builder.AddProject<Projects.Todo_Web>("web")
    .WithFlarestack(platform);

builder.Build().Run();
```

It is acceptable for the actual method names to change to match current Aspire patterns, but the consumer experience should remain this small.

Responsibilities:

- Start `bun install --frozen-lockfile` only as an explicit setup command, not on every run.
- Start and supervise `alchemy dev` in the configured working directory.
- Parse or receive a machine-readable local URL from the infra project; do not scrape colorful human console output if Alchemy offers a structured output.
- Publish the Worker endpoint in the dashboard.
- Stream Alchemy/workerd/container logs into the resource logs.
- Report health only after the Worker health endpoint is ready.
- In fast mode, pass the Aspire-started web origin to Alchemy as `FLARESTACK_LOCAL_ORIGIN`.
- In container mode, do not also start the Blazor project as a competing runtime.
- Add resource commands for `plan`, `deploy`, and optionally `destroy`; destructive commands must never run automatically.
- Contribute a deployment pipeline step so `aspire deploy` invokes the pinned Alchemy deployment command once, from the infra directory, with the selected stage.
- Forward cancellation, exit codes, and structured progress.
- Never print secret values.

Aspire's deployment extension APIs are evolving. Begin implementation with a narrow spike that proves a custom resource can contribute a deploy step on the pinned Aspire version. Isolate experimental APIs behind one internal adapter and cover it with a smoke test. If the current stable API cannot contribute a deployment step, ship `aspire run` integration first and expose `Deploy` as a dashboard/resource command plus `bun alchemy deploy`; do not pretend `aspire deploy` works.

### 5.4 `@flarestack/alchemy`

This npm package owns the reusable Alchemy construct and Worker runtime code.

Target consumer API:

```ts
import { FlarestackApp } from "@flarestack/alchemy";

export default FlarestackApp("Todo", {
  container: {
    context: "..",
    dockerfile: "../Dockerfile",
    port: 8080,
    instanceType: "lite",
    sleepAfter: "5m",
  },
  database: {
    migrations: "../migrations",
  },
  auth: {
    basePath: "/auth",
    emailAndPassword: true,
    client: {
      clientId: "todo-blazor",
      redirectUris: [
        "http://localhost:8787/signin-oidc",
        "https://todo.example.com/signin-oidc",
      ],
      postLogoutRedirectUris: [
        "http://localhost:8787/signout-callback-oidc",
        "https://todo.example.com/signout-callback-oidc",
      ],
      scopes: ["openid", "profile", "email"],
      skipConsent: true,
    },
  },
  domain: process.env.APP_DOMAIN,
});
```

This is an intended API, not a claim that these are Alchemy's exact low-level property names. Implement it over the pinned current Alchemy APIs.

The construct must create and connect:

- D1 database with numbered application migrations.
- Better Auth using the Alchemy Better Auth integration and `CloudflareD1` database layer.
- Better Auth `jwt()` and OAuth 2.1 Provider plugins with OIDC.
- Idempotent first-party OAuth client provisioning.
- Cloudflare Container built from the app Docker context.
- Worker/Durable Object/container binding required by Cloudflare Containers.
- Public request router.
- Internal D1 outbound handler.
- Internal Better Auth OIDC back-channel handler.
- Health endpoint.
- Optional custom domain/route.
- Alchemy outputs containing public URL, auth authority, client ID, and protocol version. Never output secret material.

Use Alchemy's current class/Effect-style Container APIs. A context-backed container is expected to resemble a `Cloudflare.Container` subclass with `context`, `ports`, and environment configuration, not the older simplified pseudo-resource syntax.

## 6. Worker routing

Public routing order must be explicit and tested:

1. `GET /_flarestack/health` returns Worker health and optionally container readiness.
2. Better Auth handler receives `/auth/*`.
3. Better Auth handler receives all required issuer metadata paths, including path-based OIDC discovery and OAuth authorization server metadata. Do not assume `/auth/*` alone covers `/.well-known/*` variants.
4. Static login assets, if Worker-hosted, are served explicitly.
5. Everything else proxies to either:
   - `FLARESTACK_LOCAL_ORIGIN` in fast local mode, including WebSocket upgrades; or
   - the Cloudflare Container in fidelity/production mode.

Preserve method, path, query, body, WebSocket upgrade, and relevant forwarded headers. Prevent hop-by-hop header leakage. Set trusted forwarded headers deliberately so ASP.NET reconstructs the external scheme and host.

The health endpoint must not wake the app container unless a deep readiness check is explicitly requested.

## 7. Internal protocols

### 7.1 D1 command protocol

Use a single internal endpoint and a versioned envelope:

```json
{
  "protocolVersion": 1,
  "operation": "query",
  "sql": "SELECT id, title FROM todo WHERE owner_id = ?1",
  "parameters": ["user-id"]
}
```

Supported operations:

- `query`
- `querySingleOrDefault`
- `execute`
- `batch`

Response envelope:

```json
{
  "protocolVersion": 1,
  "ok": true,
  "correlationId": "...",
  "rows": [],
  "rowsAffected": 0,
  "meta": {
    "durationMs": 1.2
  }
}
```

Error envelope:

```json
{
  "protocolVersion": 1,
  "ok": false,
  "correlationId": "...",
  "error": {
    "code": "D1_EXECUTION_FAILED",
    "message": "Database command failed"
  }
}
```

Requirements:

- Validate content type, method, version, maximum body size, SQL length, parameter count, and batch count.
- Use prepared statements and `.bind(...)`; never interpolate parameter values.
- Use D1 `batch()` for batches and preserve command ordering.
- Keep detailed provider errors in Worker logs with correlation IDs; return sanitized errors by default.
- The handler must only be registered as a container outbound handler for `d1.internal`.
- Add a test proving `https://public-host/_flarestack/d1` and similar paths are 404/proxied normally and never execute SQL.

### 7.2 Auth back-channel protocol

Register `auth.internal` as a second container outbound hostname. It invokes the same Better Auth handler used by public auth routes. The .NET OIDC back-channel rewrite maps:

```text
https://todo.example.com/auth/... -> http://auth.internal/auth/...
```

Better Auth must be configured with the browser-facing public base URL/issuer, so discovery documents and tokens continue to contain the public issuer. Never allow a request header to choose the issuer dynamically.

## 8. OAuth client provisioning

Implement an idempotent Alchemy action/resource called conceptually `EnsureOAuthClient`:

- Runs after Better Auth schema is available.
- Looks up the fixed client ID.
- Creates it if absent as a public client with exact redirect URIs and post-logout redirect URIs.
- Updates allowed metadata when configuration changes.
- Sets first-party/trusted behavior and consent skipping using supported Better Auth APIs/fields.
- Does not allow user-facing CRUD endpoints to mutate this cached trusted client.
- Does not use raw hand-written inserts unless the Better Auth API cannot perform the operation; if a fallback insert is unavoidable, isolate it, version it, and test it against the pinned Better Auth version.

The OAuth Provider plugin must include:

- `openid`, `profile`, and `email` support. Do not request `offline_access` in v0.1 because the app does not retain or use refresh tokens.
- Authorization Code + S256 PKCE.
- OIDC discovery.
- UserInfo.
- End-session support.
- Exact redirect matching.
- No dynamic client registration in v0.1.
- No client credentials grant for the Blazor client.

The login page must use Better Auth's official OAuth Provider client plugin so its signed `oauth_query` continuation is preserved. Add an end-to-end test starting at an `[Authorize]` Blazor page, not merely at the login endpoint.

## 9. Local run modes

### 9.1 Fast mode (default)

Purpose: normal application development and debugging.

```text
Aspire
  ├── Todo.Web as local .NET project on fixed internal port 5080
  └── Alchemy dev
       ├── local workerd Worker on http://localhost:8787
       ├── local D1 + migrations
       └── Better Auth

Browser -> Worker -> local Todo.Web
Todo.Web -> d1.internal/auth.internal -> Worker outbound handlers
```

Requirements:

- The browser always enters through the Worker URL, never directly through port 5080. This exercises auth, forwarding, and same-origin cookies.
- `FLARESTACK_LOCAL_ORIGIN=http://127.0.0.1:5080` tells the Worker to proxy app traffic to the Aspire-managed project.
- Aspire waits for the local web process before reporting the platform ready, or the Worker returns a clear 503 until it is ready.
- Blazor WebSocket/SignalR traffic works through workerd.
- Debugging the .NET project from the IDE remains possible.
- The public OIDC authority is `http://localhost:8787/auth`; the .NET back-channel uses `http://auth.internal`.
- HTTP metadata is permitted only when the environment is Development and the authority host is loopback.

Command:

```bash
aspire run
```

### 9.2 Fidelity mode

Purpose: validate the production-like container topology locally.

```text
Aspire
  └── Alchemy dev
       ├── local workerd Worker
       ├── local D1 + migrations
       ├── Better Auth
       └── Dockerized Todo.Web container
```

Aspire must not start a second Todo.Web process in this mode.

Select mode through configuration, for example:

```bash
Flarestack__LocalMode=Container aspire run
```

or an equivalent documented Aspire argument. Avoid maintaining two different application configurations; only the location of the Blazor runtime changes.

### 9.3 Direct Alchemy mode

For diagnosing the infra package independently:

```bash
cd samples/Todo/infra
bun install --frozen-lockfile
bun alchemy dev
```

This runs fidelity mode. Document it as an escape hatch, not the primary workflow.

## 10. Production deployment

Primary command:

```bash
aspire deploy
```

Expected pipeline:

1. Validate required local tools and versions.
2. Build/test or require a clean prior build according to the selected deployment policy.
3. Invoke `bun alchemy deploy --stage <stage>` once.
4. Alchemy applies Better Auth schema/actions and app D1 migrations.
5. Alchemy builds the Dockerfile, publishes the image, deploys the Container/DO and Worker, and configures route/domain.
6. Return and display public URL and health status.

Alchemy state must be remote/durable for team or CI use. Do not rely solely on a developer machine's local state. Document the selected Alchemy state backend and bootstrap procedure.

Required production configuration:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
APP_DOMAIN
BETTER_AUTH_SECRET (or Alchemy-managed stable secret)
ALCHEMY_STAGE
```

Use the least-privileged Cloudflare API token possible. Secrets must come from environment/secret storage and be wrapped in Alchemy's redacted/secret mechanism. Never commit them or echo them in plans.

The Todo container Dockerfile should use a conventional multi-stage .NET 10 build, listen on port 8080, run as a non-root user where supported, and expose a lightweight ASP.NET health endpoint.

Add a separate CI document after local deploy works. A minimal CI job should restore Bun/.NET dependencies from lockfiles, run all non-cloud tests, and invoke the same `aspire deploy` or Alchemy command with a named stage.

## 11. Todo sample

### 11.1 Schema

`migrations/0001_todos.sql`:

```sql
CREATE TABLE todo (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX ix_todo_owner_created
    ON todo(owner_id, created_at DESC);
```

### 11.2 Application behavior

- Landing page is public and offers Sign in.
- Todo page requires `[Authorize]`.
- Email/password registration and sign-in are sufficient for v0.1.
- Display current user's email/name and a logout action.
- CRUD operations always take `ownerId` from `ClaimsPrincipal`; never accept it from the browser.
- Update/delete SQL includes both `id` and `owner_id` in the predicate.
- Use server-side validation for title length and emptiness.
- Use optimistic UI only after baseline correctness works.

Suggested service boundary:

```csharp
public sealed class CurrentUser(ClaimsPrincipal principal)
{
    public string Id => principal.FindFirstValue("sub")
        ?? throw new InvalidOperationException("Authenticated user has no sub claim.");
}
```

Do not register a request-specific `ClaimsPrincipal` as a singleton. Resolve it through `IHttpContextAccessor` or Blazor's authentication state in the appropriate scope.

### 11.3 Startup

The sample should be close to:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddHttpContextAccessor();
builder.Services.AddFlarestackD1(builder.Configuration);
builder.Services.AddFlarestackAuthentication(builder.Configuration);
builder.Services.AddAuthorization();
builder.Services.AddScoped<TodoRepository>();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseAuthentication();
app.UseAuthorization();
app.MapFlarestackAccountEndpoints();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();
app.MapDefaultEndpoints();

app.Run();
```

Confirm middleware ordering with integration tests.

## 12. Testing strategy

### 12.1 Unit tests

`Flarestack.D1.Tests`:

- Parameter conversion for every supported type.
- Unsupported type rejection.
- snake_case row mapping.
- zero/one/multiple row cardinality.
- cancellation and timeout behavior.
- sanitized error mapping.
- batch ordering.

`Flarestack.Authentication.Tests`:

- Expected cookie/OIDC scheme configuration.
- Authority and scope validation.
- Back-channel URI rewriting and strict origin matching.
- Loopback-only HTTP metadata exception.
- safe return URL handling.
- claim mapping.

`Aspire.Hosting.Flarestack.Tests`:

- Resource annotations/environment values.
- mode selection.
- command construction without shell interpolation.
- deploy exit-code propagation.
- secrets redaction.

### 12.2 Worker tests

Use the current Cloudflare Worker test tooling supported by the pinned stack.

- Public router sends auth and discovery paths to Better Auth.
- Other traffic reaches the correct origin/container.
- WebSocket upgrades are preserved.
- D1 bridge rejects malformed/version-mismatched requests.
- D1 bridge binds values rather than interpolating.
- Batch ordering and rollback behavior match D1 expectations.
- D1 bridge is unreachable publicly.
- `auth.internal` is only an outbound virtual host.
- OAuth client provisioner is idempotent.

### 12.3 End-to-end tests

Run against `alchemy dev` in fidelity mode:

1. Start at `/todos` while signed out.
2. Observe OIDC challenge and Better Auth login page.
3. Register a new user.
4. Complete the authorization flow and land back on `/todos` authenticated.
5. Create, complete, reopen, and delete a todo.
6. Log out and confirm `/todos` challenges again.
7. Create a second user and prove it cannot see or mutate the first user's rows.
8. Restart the Blazor container and prove D1/auth data persists in the local simulator.
9. Exercise Blazor's WebSocket connection through the Worker.

Add one opt-in cloud smoke test that deploys to an isolated stage, checks discovery/health, performs a basic auth flow if practical, and destroys only that explicitly named test stage.

## 13. Observability and diagnostics

- Add correlation IDs at the Worker edge and forward them to ASP.NET and the D1 bridge.
- Emit OpenTelemetry-compatible activities from the .NET D1 client.
- Include operation type and duration, but not SQL/parameters by default.
- Expose shallow Worker health and container health separately.
- Put Worker, Alchemy, and app logs in Aspire's dashboard during local runs where the current integrations permit it.
- Fail startup with clear configuration errors for missing authority, client ID, D1 base address, invalid redirect URIs, or mode conflicts.

## 14. Security requirements

- No public arbitrary-SQL endpoint.
- Prepared statements for all parameter values.
- Exact OAuth redirect URIs; never wildcard them.
- PKCE S256, state, nonce, issuer, and audience validation remain enabled.
- `oauth_query` is treated as provider-signed opaque state and handled by the official client plugin.
- Only configured public-authority origins may be rewritten to `auth.internal`.
- Validate local return URLs before redirecting.
- Cookies are HttpOnly and Secure outside loopback development.
- Better Auth signing secret is stable across deployments and never logged.
- Cloudflare token is least privilege.
- App authorization is enforced in SQL predicates as well as UI route protection.
- Rate-limit or otherwise protect sign-in/sign-up endpoints before calling the project production-ready.
- Document account enumeration, password policy, email verification, reset flow, and CSRF behavior as pre-production hardening items if they are not implemented in v0.1.

## 15. Implementation phases

### Phase 0: compatibility spikes

Before building abstractions, create disposable proofs for the pinned versions:

1. Alchemy deploys a trivial .NET 10 HTTP container and proxies a Worker request to it.
2. `alchemy dev` runs that container in Docker.
3. A container outbound handler reaches local and remote D1.
4. Better Auth OAuth Provider exposes OIDC discovery from a path-based issuer.
5. ASP.NET Core completes OIDC login against it.
6. Aspire custom resource starts `alchemy dev` and shows an endpoint.
7. Aspire custom deployment hook can invoke an external deployment command.

Record exact versions and any API deviations in `docs/compatibility.md`. Do not begin polishing package APIs until items 1-5 work.

### Phase 1: D1 vertical slice

- Implement Worker D1 bridge and `Flarestack.D1`.
- Run Todo CRUD without authentication using a fixed owner ID.
- Test fast, fidelity, and deployed modes.

### Phase 2: authentication vertical slice

- Add Better Auth, OAuth Provider, client provisioning, login UI, ASP.NET OIDC, and logout.
- Replace fixed owner with `sub`.
- Complete two-user isolation E2E test.

### Phase 3: Aspire integration

- Package custom resource and fast/fidelity modes.
- Add dashboard endpoint, health, logs, and commands.
- Wire `aspire deploy` if supported by the pinned stable deployment API.

### Phase 4: packaging and template

- Pack NuGet/npm packages locally.
- Make the sample consume packages rather than project internals.
- Add `dotnet new flarestack-blazor -n MyApp` only after the sample is stable.
- Write upgrade/version compatibility policy.

## 16. Definition of done for v0.1

The work is complete when all of the following are true:

- A fresh checkout has documented prerequisites and reproducible lockfiles.
- `aspire run` starts fast mode and exposes one browser URL in the dashboard.
- Fidelity mode runs the same app inside Docker through Alchemy.
- Better Auth email/password signup and login complete a real OIDC Authorization Code + PKCE flow into ASP.NET Core.
- The Blazor app uses an ASP.NET authentication cookie and standard `[Authorize]`/`AuthorizeView` APIs.
- Todo data is stored in D1 through `ID1Database` and the internal outbound bridge.
- No public route executes arbitrary SQL.
- Two-user data isolation is tested.
- Numbered app migrations and Better Auth schema setup work from an empty database and are idempotent on a second run.
- `aspire deploy` deploys through Alchemy, or the limitation is explicitly documented and an honest supported deployment command is exposed.
- A deployed Cloudflare stage passes health, OIDC discovery, login, CRUD, logout, and restart persistence smoke tests.
- The sample references packaged artifacts and contains no unpublished internal shortcuts.

## 17. Agent working rules

- Treat code blocks in this brief as intended interfaces or pseudocode unless confirmed against the pinned dependency version.
- Prefer the current official APIs over preserving a stale example verbatim.
- Keep Cloudflare/Alchemy types out of application projects.
- Keep experimental Aspire deployment code isolated.
- Commit in vertical slices that remain runnable.
- When blocked by a framework limitation, document the exact limitation and choose the smallest honest fallback; do not silently simulate missing behavior.
- Do not add scope beyond v0.1 until the Todo E2E path passes in both local modes.

## 18. Primary references

- [Alchemy Cloudflare Containers](https://alchemy.run/cloudflare/compute/containers/)
- [Alchemy D1](https://alchemy.run/cloudflare/data/d1/)
- [Alchemy local development](https://alchemy.run/cloudflare/local-development/)
- [Alchemy Better Auth integration](https://alchemy.run/better-auth/)
- [Better Auth OAuth 2.1 Provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Cloudflare Containers: connect to Workers and bindings](https://developers.cloudflare.com/containers/configuration/workers-connections/)
- [Aspire custom hosting integrations](https://aspire.dev/integrations/custom-integrations/hosting-integrations/)
- [Aspire deployment overview](https://aspire.dev/deployment/overview/)

## 19. First implementation task

Start with Phase 0 and produce a minimal `compatibility-spike` branch. The first review artifact should contain:

1. Exact pinned versions.
2. A tiny .NET endpoint running in an Alchemy-managed Cloudflare Container.
3. A Worker route proxying HTTP and WebSockets to it.
4. A container outbound request that executes `SELECT 1 AS value` against D1 without any public SQL route.
5. Better Auth path-based OIDC discovery.
6. A short compatibility report listing which proposed APIs in this brief compile as written and which required adaptation.

Only after that review should the agent establish the final package API surface.
