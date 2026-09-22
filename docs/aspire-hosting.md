# Aspire hosting

The normal entrypoint uses the package root namespace and builder configuration:

```csharp
using Aspire.Hosting.Flarestack;

var builder = DistributedApplication.CreateBuilder(args);
builder.AddFlarestack("cloudflare", "../infra");
builder.Build().Run();
```

`Flarestack:LocalMode` defaults to `Fast`; `Flarestack:ApplicationName` defaults to
`cloudflare-app` here. The template sets the application name to `app` in its
AppHost settings. Machine dashboard ports apply to this builder without mutating
process-wide environment variables. Explicit command-line endpoint overrides win.
No pre-builder call is needed. In publish mode the same registration exposes the
[deployment pipeline](deployment.md) without starting local resources.

## Explicit resource composition


Create the platform, then explicitly attach the application declared by its infrastructure manifest:

```csharp
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Registration;

var cloudflare = builder.AddFlarestackPlatform(
        "cloudflare", "../infra", mode: FlarestackLocalMode.Fast)
    .WithApplication("todo");

var publicEndpoint = cloudflare.GetEndpoint("http");
```

`AddFlarestackPlatform` returns `IResourceBuilder<FlarestackPlatformResource>`. The typed resource is the actual Alchemy supervisor, derived from Aspire's `ExecutableResource`, so standard resource builder methods such as `WithEnvironment`, `GetEndpoint`, and `WaitFor` apply. `Mode` is fixed at creation. `Application` exposes the fast-mode watcher after attachment and is null before attachment and in Container mode. Bridge credentials remain internal and are passed as secret parameter references.

| Mode | Aspire-owned processes | Application attachment |
| --- | --- | --- |
| `Fast` (default) | Alchemy supervisor and traced manifest watch command | `WithApplication` adds the watcher, bridge configuration, OTLP exporter, and health dependency |
| `Container` | Alchemy supervisor | `WithApplication` acknowledges the manifest-defined application; Alchemy creates and manages its container |

Alchemy remains the sole owner of Workers, D1, migrations, and containers. `WithApplication` does not accept an arbitrary project path or change the infrastructure manifest. Its `name` parameter names the Aspire watcher in Fast mode; in Container mode it is validated but no additional application resource is created. Attachment is allowed once in either mode. Invalid or conflicting application names are rejected before attachment, leaving the platform available for a corrected call. Names follow Aspire's default ASCII resource naming policy (1–64 characters, starting with a letter, letters/digits/hyphens only, no consecutive or trailing hyphens). Aspire's current validator is internal, so this small validation rule is explicit here.

A Fast platform without `WithApplication` fails in Aspire's `BeforeStartEvent`, before process startup. A Container platform can run by itself: the manifest and Alchemy already define its application. Attaching a platform through a resource builder belonging to another application builder is rejected.

The platform publishes `http` and `inbox` endpoints in both modes and `bridge` in Fast mode, retaining fixed local ports and unproxied endpoints. The watcher receives its allocated HTTP endpoint through `ASPNETCORE_URLS`; the supervisor references the same endpoint through `FLARESTACK_LOCAL_ORIGIN`. D1, email, and authentication backchannel addresses reference the platform bridge endpoint. The watcher waits for the platform's readiness health check. Existing origin validation, shared bridge token, and OTLP collection remain unchanged.

The legacy `AddFlarestack(name, infrastructureDirectory, configure)` API still returns `FlarestackResources`, automatically attaches the application, and preserves its existing configuration behavior. Both entry points use the same internal resource composition.

## Why the manifest commands remain

The installed Aspire.Hosting 13.5.3 executable API was checked before implementing the typed resource. Its `AddExecutable` implementation adds an `ExecutableResource` and argument annotation; the typed resource uses the equivalent `AddResource(...).WithArgs(...)` composition with the same resolved working directory. The standard resource builder is covariant, preserving the legacy return contract. See the [version-pinned Aspire executable source](https://github.com/microsoft/aspire/blob/b5f143315ffb6968ea939a9978797a5b20e4c688/src/Aspire.Hosting/ExecutableResourceBuilderExtensions.cs).

Aspire's native [`AddBunApp`](https://aspire.dev/reference/api/csharp/aspire.hosting.javascript/javascripthostingextensions/methods/#addbunapp) runs a Bun script directly and supplies JavaScript package-manager/container publishing conventions. It would not preserve the infrastructure contract's arbitrary direct development and watch commands, including the existing telemetry wrappers, without translating that contract. This change therefore retains the validated single-command parser and does not add the JavaScript integration package or a package-manager installer process.

An `AddProject(...).WithFlarestack(...)` facade would also obscure ownership: Aspire would create a second application process in Container mode, and the manifest's traced watcher would be bypassed in Fast mode. The explicit manifest application attachment represents the current lifecycle directly. The same platform owns the custom deploy pipeline described in [deployment](deployment.md).
