using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;

namespace Flarestack.Hosting;

public enum FlarestackLocalMode { Fast, Container }

public static class FlarestackHosting
{
    public static IResourceBuilder<ExecutableResource> AddFlarestack(this IDistributedApplicationBuilder builder,
        string name, string repositoryRoot, FlarestackLocalMode mode, IResourceBuilder<ParameterResource> bridgeToken)
    {
        return builder.AddExecutable(name, "bun", repositoryRoot, "spikes/compatibility/local/dev.ts")
            .WithEnvironment("FLARESTACK_EXTERNAL_OTLP", "1")
            .WithEnvironment("FLARESTACK_LOCAL_MODE", mode.ToString())
            .WithEnvironment("FLARESTACK_LOCAL_BRIDGE_TOKEN", bridgeToken)
            .WithHttpEndpoint(port: 8787, targetPort: 8787, name: "http", isProxied: false)
            .WithHttpHealthCheck("/_flarestack/health")
            .WithOtlpExporter(OtlpProtocol.HttpProtobuf);
    }
}
