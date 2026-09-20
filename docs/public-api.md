# Public API examples

## .NET application

```csharp
builder.Services.AddFlarestackD1(builder.Configuration);
builder.Services.AddFlarestackEmail(builder.Configuration);
builder.Services.AddFlarestackAuthentication(builder.Configuration);
// After building the app and configuring authentication/authorization middleware:
app.MapFlarestackAccountEndpoints(options => options.DefaultReturnPath = "/todos");
```

Use standard `[Authorize]`, `AuthorizeView`, roles and `AuthenticationStateProvider`.
Inject `ICurrentUser` and call `GetRequiredIdAsync(ct)` to obtain a live-validated
owner inside repositories. `GetPrincipalAsync(ct)` returns the validated identity.

`ID1Database` provides `QueryAsync<T>`, `QuerySingleOrDefaultAsync<T>`,
`ExecuteAsync`, and `BatchAsync` (`D1Command`/`D1CommandResult`). Each accepts a
cancellation token; use separate SQL parameters and ownership predicates.

```csharp
var owner = await currentUser.GetRequiredIdAsync(ct);
var rows = await database.QueryAsync<TodoItem>(
    "SELECT * FROM todo WHERE owner_id = ?1", [owner], ct);

// IUserAdministration resolves the actor internally and enforces the admin policy.
var page = await admin.ListAsync(search: "person@example.com", offset: 0);
await admin.SetRoleAsync(userId, UserRole.Admin, ct);
await admin.SetDisabledAsync(userId, true, ct);
await admin.RevokeSessionsAsync(userId, ct);

// IFlarestackEmailSender: acceptance is distinct from inbox delivery.
EmailSendResult receipt = await email.SendAsync(
    new EmailMessage("person@example.com", "Welcome", "Your account is ready."), ct);
```

Administration returns `UserPage(Users, Total)`, with 50 users per page and exact
email lookup. `UserRole` is constrained to `User`/`Admin`. Email receipts have
`State` and nullable `ProviderMessageId`; local raw MIME acceptance has no provider
ID. HTML alternatives, multiple recipients, reply-to, attachments, idempotency and
delivery notifications are intentionally unsupported. Future metadata can extend
the receipt without changing `SendAsync` from a void-returning task.

### Email configuration

The overload with a callback binds `EmailOptions.SectionName` (`Flarestack:Email`),
then applies caller overrides:

```csharp
builder.Services.AddFlarestackEmail(builder.Configuration, options =>
{
    options.Timeout = TimeSpan.FromSeconds(15);
});
```

`EmailOptions.BaseAddress` defaults to `http://email.internal`; `Timeout` defaults
to 30 seconds. Configuration uses a TimeSpan string, for example
`"Flarestack": { "Email": { "Timeout": "00:00:15" } }`. Pass `static _ => { }`
as the callback to use this overload with configuration alone.

This overload validates options at host startup, or on first options access if
earlier, including later `Configure<EmailOptions>` and `PostConfigure<EmailOptions>`
changes. The address must be absolute HTTP(S); a configured shared
`Flarestack:LocalBridgeToken` requires a loopback address. The token is captured at
registration and is not an email option. Timeout accepts a positive duration up
to 2,147,483,647 milliseconds, or `Timeout.InfiniteTimeSpan`.

The existing two-argument overload preserves immediate address/security
validation and a fixed 30-second timeout; it does not read the new `Timeout` key.
The new client consumes `IOptions<EmailOptions>`; live reconfiguration is not
supported. Both overloads retain the same email transport and do not retry sends.

### Other client configuration

D1 and Authentication also provide configuration-plus-callback overloads. They
bind their configuration sections before caller overrides and validate final
options at startup. The existing two-argument overloads remain available.

```csharp
builder.Services.AddFlarestackD1(builder.Configuration, options =>
{
    options.TimeoutSeconds = 15;
    options.MaxCommands = 50;
});
builder.Services.AddFlarestackAuthentication(builder.Configuration, options =>
{
    options.ClientId = "my-app";
});
```

See [D1 configuration](d1-configuration.md) and
[Authentication configuration](authentication-configuration.md) for defaults,
validation, and security constraints. The Todo sample uses the callback overloads
with empty callbacks to enable startup validation using configuration alone.

## Aspire and infrastructure

```csharp
FlarestackLocal.Configure("../infra"); // Apply optional machine dashboard ports.
var builder = DistributedApplication.CreateBuilder(args);
var platform = builder.AddFlarestackPlatform("cloudflare", "../infra", FlarestackLocalMode.Fast)
    .WithApplication("app");
builder.Build().Run();
```

The infrastructure `package.json` declares `flarestack.configuration`, `release`,
`protocol` and `flarestack:dev`/`flarestack:watch` scripts. Hosting discovers and
launches those single executable commands directly, preserving Aspire signal
ownership. Compound shell scripts are rejected. Consumers do not pass npm runtime
paths to the hosting API. The typed platform supports standard Aspire endpoint and
environment extensions. See [Aspire hosting](aspire-hosting.md) for attachment and
mode semantics. The existing `AddFlarestack` overload and its `FlarestackResources`
result remain supported. Do not add a second app process in
Container mode; Fast mode keeps the tested .NET watcher rather than duplicating it
with a separate `AddProject` resource.

Import from `@flarestack/alchemy`:

- `createAuthWorker({ main, database, client, email?, features? })`
- `createEmailWorker({ main, from })`
- `FlarestackApp({ name, database, auth, email?, workerMain, container, local })`

The OAuth client has `clientId`, `clientName`, and stable `resourceId`. Auth features
include `requireEmailVerification`, additional Better Auth `plugins` and
`databaseHooks`. Bootstrap IDs come from `FLARESTACK_ADMIN_USER_IDS`.
Numbered app migrations, auth schema migration and client provisioning stay under
Alchemy ownership.

## Routes

The starter provides `/todos`, `/account/sign-in`, `/account/forgot-password`,
`/account/reset-password`, `/account/settings`, `/account/security`, `/admin/users`.
The framework maps `/account/login`, antiforgery-protected `POST /account/logout`
and `/account/access-denied`. Better Auth serves `/auth/*`.
SQL, email and internal administration bridges are private, not public REST APIs.

## Interactive Auto application API

The starter shares `ITodoService` between Server and WebAssembly rendering. Browser
CRUD uses authenticated `/api/todos` endpoints with antiforgery protection; server
components inject the owner-filtered repository. See [Interactive Auto](interactive-auto.md)
for the HTTP contract and guidance on keeping private bindings out of the client.
