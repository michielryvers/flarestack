using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using System.Security.Cryptography;
using System.Text.Json;

namespace Flarestack.Hosting;

public enum FlarestackLocalMode { Fast, Container }

public sealed class FlarestackOptions
{
    public FlarestackLocalMode Mode { get; set; } = FlarestackLocalMode.Fast;
    public string ApplicationName { get; set; } = "app";
}

public sealed record FlarestackResources(
    IResourceBuilder<ExecutableResource> Platform,
    IResourceBuilder<ExecutableResource>? Application);

public static class FlarestackHosting
{
    /// <summary>Add the Alchemy supervisor and, in fast mode, the traced .NET watcher.</summary>
    public static FlarestackResources AddFlarestack(this IDistributedApplicationBuilder builder,
        string name, string infrastructureDirectory, Action<FlarestackOptions>? configure = null)
    {
        var options = new FlarestackOptions(); configure?.Invoke(options);
        if (!Enum.IsDefined(options.Mode)) throw new ArgumentException("Mode must be Fast or Container.", nameof(options));
        var infra = Path.GetFullPath(infrastructureDirectory, builder.AppHostDirectory);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(infra, "package.json")));
        var contract = manifest.RootElement.GetProperty("flarestack");
        if (contract.GetProperty("protocol").GetInt32() != 2 || contract.GetProperty("release").GetString() != "0.1.0-local.2")
            throw new InvalidOperationException("Aspire.Hosting.Flarestack 0.1.0-local.2 expects infrastructure protocol 2 and the same package release. Upgrade the full package set.");
        foreach (var script in new[] { "flarestack:dev", "flarestack:watch" })
            if (!manifest.RootElement.GetProperty("scripts").TryGetProperty(script, out _)) throw new InvalidOperationException($"Infrastructure package must declare {script}.");
        string[] Script(string name) {
            var text = manifest.RootElement.GetProperty("scripts").GetProperty(name).GetString()!;
            // Launch the declared command directly so Aspire owns its signals/PID.
            // Compound shell scripts would obscure lifecycle ownership.
            if (text.IndexOfAny([';', '|', '&', '$', '`', '\n', '\r']) >= 0)
                throw new InvalidOperationException($"{name} must be one executable command, without shell operators.");
            return System.Text.RegularExpressions.Regex.Matches(text, "\"([^\"]*)\"|'([^']*)'|([^\\s]+)")
                .Select(m => m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value).ToArray();
        }
        var dev = Script("flarestack:dev"); var watch = Script("flarestack:watch");
        if (dev.Length == 0 || watch.Length == 0) throw new InvalidOperationException("Flarestack scripts cannot be empty.");
        var configPath = Path.GetFullPath(contract.GetProperty("configuration").GetString()!, infra);
        var directory = Path.GetDirectoryName(configPath)!;
        using var config = JsonDocument.Parse(FlarestackLocal.ReadConfiguration(configPath).ToJsonString());
        string Required(string key) => config.RootElement.GetProperty(key).GetString() is { Length: > 0 } value
            ? value : throw new InvalidOperationException($"Missing Flarestack local setting: {key}");
        var origin = new Uri(Required("publicOrigin"));
        var bridgePort = config.RootElement.GetProperty("bridgePort").GetInt32();
        if (!origin.IsLoopback || origin.Scheme != "http" || origin.AbsolutePath != "/" || origin.Query.Length > 0 || origin.UserInfo.Length > 0 || origin.Fragment.Length > 0)
            throw new InvalidOperationException("Local publicOrigin must be a loopback HTTP origin.");
        if (bridgePort is < 1 or > 65535 || bridgePort == origin.Port) throw new InvalidOperationException("Invalid bridgePort.");
        var inboxPort = config.RootElement.TryGetProperty("inboxPort", out var inbox) ? inbox.GetInt32() : 8810;
        if (inboxPort is < 1 or > 65535 || inboxPort == bridgePort || inboxPort == origin.Port) throw new InvalidOperationException("Invalid inboxPort.");
        var root = Path.GetFullPath(Required("buildRoot"), directory);
        var project = Path.GetFullPath(Required("project"), directory);
        foreach (var path in new[] { project, Path.Combine(infra, "alchemy.run.ts") })
            if (!File.Exists(path)) throw new FileNotFoundException("Flarestack input not found.", path);
        var token = builder.AddParameter($"{name}-bridge-token", () => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), secret: true);
        var platform = builder.AddExecutable(name, dev[0], infra, dev[1..])
            .WithEnvironment("FLARESTACK_EXTERNAL_OTLP", "1")
            .WithEnvironment("FLARESTACK_ADMIN_USER_IDS", builder.Configuration["Flarestack:AdminUserIds"] ?? Environment.GetEnvironmentVariable("FLARESTACK_ADMIN_USER_IDS") ?? "")
            .WithEnvironment("FLARESTACK_LOCAL_MODE", options.Mode.ToString())
            .WithEnvironment("FLARESTACK_LOCAL_BRIDGE_TOKEN", token)
            .WithHttpEndpoint(port: origin.Port, targetPort: origin.Port, name: "http", isProxied: false)
            .WithHttpEndpoint(port: inboxPort, targetPort: inboxPort, name: "inbox", isProxied: false)
            .WithHttpHealthCheck("/_flarestack/ready", endpointName: "http")
            .WithOtlpExporter(OtlpProtocol.HttpProtobuf);
        IResourceBuilder<ExecutableResource>? app = null;
        if (options.Mode == FlarestackLocalMode.Fast)
        {
            platform.WithHttpEndpoint(port: bridgePort, targetPort: bridgePort, name: "bridge", isProxied: false);
            app = builder.AddExecutable(options.ApplicationName, watch[0], infra, watch[1..])
                .WithHttpEndpoint(name: "http", isProxied: false)
                .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
                .WithEnvironment("Flarestack__Authentication__Authority", origin.GetLeftPart(UriPartial.Authority) + "/auth")
                .WithEnvironment("Flarestack__D1__BaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__Email__BaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__Authentication__BackchannelBaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__LocalBridgeToken", token)
                .WithOtlpExporter(OtlpProtocol.HttpProtobuf)
                .WithHttpHealthCheck("/health")
                .WaitFor(platform);
            app.WithEnvironment("ASPNETCORE_URLS", app.GetEndpoint("http"));
            platform.WithEnvironment("FLARESTACK_LOCAL_ORIGIN", app.GetEndpoint("http"));
        }
        return new(platform, app);
    }
}
