# Canonical Aspire setup and compatibility

The root `Aspire.Hosting.Flarestack` namespace now provides the short setup path:

```csharp
using Aspire.Hosting.Flarestack;

var builder = DistributedApplication.CreateBuilder(args);
builder.AddFlarestack("cloudflare", "../infra");
builder.Build().Run();
```

The name identifies the platform. In local run mode, `Flarestack:LocalMode` selects `Fast` (the default) or `Container`. `Flarestack:ApplicationName` selects the fast-mode watcher name; its default is the platform name plus `-app`, so `AddFlarestack("app", "../infra")` creates distinct `app` and `app-app` resource names. Existing applications can configure `todo` or `app` explicitly to preserve their dashboard resource names. In Container mode Alchemy continues to own the application container and Aspire creates no second application process.

Machine dashboard settings are applied to the current builder after its creation. The root registration reads the existing local configuration and permitted `local.machine.json` overrides, then maps configured dashboard, OTLP HTTP, OTLP gRPC, and resource-service ports to Aspire's configuration keys. It does not mutate process-global environment variables. Two builders therefore keep separate settings.

Machine ports override launch-profile/default configuration. Explicit AppHost command-line endpoint values retain precedence, and callers can override `builder.Configuration` after registration. Without a configured `dashboardPort`, the existing Aspire endpoint configuration is untouched. All four ports must be present and valid when dashboard ports are configured.

The mapping appends one configuration provider while preserving explicit command-line endpoint values. It deliberately avoids inserting/reordering existing providers, because rebuilding `ConfigurationManager` providers could discard values already set by the caller or Aspire. The pinned Aspire 13.5.3 [dashboard options implementation](https://github.com/microsoft/aspire/blob/b5f143315ffb6968ea939a9978797a5b20e4c688/src/Aspire.Hosting/Dashboard/DashboardOptions.cs) reads these configuration values when options are resolved, so a pre-builder environment mutation is unnecessary.

Publish/deploy mode bypasses local mode parsing, dashboard configuration, and local files. It retains the deployment adapter described in [the deployment ADR](deployment-pipeline.md).

The existing `Registration.FlarestackHosting.AddFlarestack` method retains its signature, defaults, and behavior. Its four-parameter overload (including the optional callback) remains available for explicit legacy registration. `FlarestackLocal.Configure` remains available to existing callers, but the new root setup does not require it. Typed `AddFlarestackPlatform(...).WithApplication(...)` composition remains unchanged.

The new root extension has exactly three parameters, including the extension receiver, and returns the existing `FlarestackResources` type. If both root and `Registration` namespaces are imported, a call without a callback selects the exact new overload; calls with a callback continue to select the legacy overload. Use `Registration.FlarestackHosting.AddFlarestack(...)` explicitly when retaining legacy default behavior is required. Public API baselines include only the new root class and method.
