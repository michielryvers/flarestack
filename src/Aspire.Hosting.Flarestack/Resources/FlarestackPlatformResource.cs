using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Infrastructure;

namespace Aspire.Hosting.Flarestack.Resources;

/// <summary>The Alchemy supervisor that owns local Workers, D1, migrations, and containers.</summary>
public sealed class FlarestackPlatformResource : ExecutableResource
{
    internal FlarestackPlatformResource(
        string name,
        string infrastructureDirectory,
        FlarestackLocalMode mode,
        FlarestackInfrastructureManifest manifest,
        FlarestackLocalSettings settings,
        IResourceBuilder<ParameterResource> bridgeToken,
        IDistributedApplicationBuilder applicationBuilder)
        : base(name, manifest.DevelopmentCommand[0], infrastructureDirectory)
    {
        Mode = mode;
        Manifest = manifest;
        Settings = settings;
        BridgeToken = bridgeToken;
        ApplicationBuilder = applicationBuilder;
    }

    /// <summary>The local execution mode selected when this platform was created.</summary>
    public FlarestackLocalMode Mode { get; }

    /// <summary>The attached fast-mode .NET watcher; null before attachment and in Container mode.</summary>
    public ExecutableResource? Application => ApplicationResource?.Resource;

    internal FlarestackInfrastructureManifest Manifest { get; }
    internal FlarestackLocalSettings Settings { get; }
    internal IResourceBuilder<ParameterResource> BridgeToken { get; }
    internal IDistributedApplicationBuilder ApplicationBuilder { get; }
    internal IResourceBuilder<ExecutableResource>? ApplicationResource { get; set; }
    internal bool IsApplicationAttached { get; set; }
}
