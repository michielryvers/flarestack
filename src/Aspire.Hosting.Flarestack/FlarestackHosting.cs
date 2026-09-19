using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using System.Security.Cryptography;
using System.Text.Json;

namespace Flarestack.Hosting;

public enum FlarestackLocalMode { Fast, Container }

public sealed record FlarestackOptions(string ConfigurationFile, string RuntimeDirectory)
{
    public FlarestackLocalMode Mode { get; init; } = FlarestackLocalMode.Fast;
    public string ApplicationName { get; init; } = "app";
}

public sealed record FlarestackResources(
    IResourceBuilder<ExecutableResource> Platform,
    IResourceBuilder<ExecutableResource>? Application);

public static class FlarestackHosting
{
    /// <summary>Add the Alchemy supervisor and, in fast mode, the traced .NET watcher.</summary>
    public static FlarestackResources AddFlarestack(this IDistributedApplicationBuilder builder,
        string name, FlarestackOptions options)
    {
        if (!Enum.IsDefined(options.Mode)) throw new ArgumentException("Mode must be Fast or Container.", nameof(options));
        var configPath = Path.GetFullPath(options.ConfigurationFile, builder.AppHostDirectory);
        var runtime = Path.GetFullPath(options.RuntimeDirectory, builder.AppHostDirectory);
        var directory = Path.GetDirectoryName(configPath)!;
        using var config = JsonDocument.Parse(File.ReadAllText(configPath));
        string Required(string key) => config.RootElement.GetProperty(key).GetString() is { Length: > 0 } value
            ? value : throw new InvalidOperationException($"Missing Flarestack local setting: {key}");
        var origin = new Uri(Required("publicOrigin"));
        var bridgePort = config.RootElement.GetProperty("bridgePort").GetInt32();
        if (!origin.IsLoopback || origin.Scheme != "http" || origin.AbsolutePath != "/" || origin.Query.Length > 0 || origin.UserInfo.Length > 0 || origin.Fragment.Length > 0)
            throw new InvalidOperationException("Local publicOrigin must be a loopback HTTP origin.");
        if (bridgePort is < 1 or > 65535 || bridgePort == origin.Port) throw new InvalidOperationException("Invalid bridgePort.");
        var root = Path.GetFullPath(Required("buildRoot"), directory);
        var project = Path.GetFullPath(Required("project"), directory);
        foreach (var path in new[] { project, Path.Combine(runtime, "dev.ts"), Path.Combine(runtime, "watch-dotnet.ts"), Path.Combine(directory, Required("infrastructureDirectory"), "alchemy.run.ts") })
            if (!File.Exists(path)) throw new FileNotFoundException("Flarestack input not found.", path);
        var token = builder.AddParameter($"{name}-bridge-token", () => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), secret: true);
        var platform = builder.AddExecutable(name, "bun", root, Path.Combine(runtime, "dev.ts"), configPath)
            .WithEnvironment("FLARESTACK_EXTERNAL_OTLP", "1")
            .WithEnvironment("FLARESTACK_LOCAL_MODE", options.Mode.ToString())
            .WithEnvironment("FLARESTACK_LOCAL_BRIDGE_TOKEN", token)
            .WithHttpEndpoint(port: origin.Port, targetPort: origin.Port, name: "http", isProxied: false)
            .WithHttpHealthCheck("/_flarestack/health")
            .WithOtlpExporter(OtlpProtocol.HttpProtobuf);
        IResourceBuilder<ExecutableResource>? app = null;
        if (options.Mode == FlarestackLocalMode.Fast)
        {
            platform.WithHttpEndpoint(port: bridgePort, targetPort: bridgePort, name: "bridge", isProxied: false);
            app = builder.AddExecutable(options.ApplicationName, "bun", root, Path.Combine(runtime, "watch-dotnet.ts"), project)
                .WithHttpEndpoint(name: "http", isProxied: false)
                .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
                .WithEnvironment("Flarestack__D1__BaseAddress", platform.GetEndpoint("bridge"))
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
