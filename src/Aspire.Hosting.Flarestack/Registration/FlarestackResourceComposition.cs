using System.Security.Cryptography;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Deployment;
using Aspire.Hosting.Flarestack.Infrastructure;
using Aspire.Hosting.Flarestack.Resources;

namespace Aspire.Hosting.Flarestack.Registration;

internal static class FlarestackResourceComposition
{
    internal static IResourceBuilder<FlarestackPlatformResource> AddPlatform(
        IDistributedApplicationBuilder builder,
        string name,
        string infrastructureDirectory,
        FlarestackLocalMode mode)
    {
        var infrastructurePath = Path.GetFullPath(infrastructureDirectory, builder.AppHostDirectory);
        var manifest = FlarestackInfrastructureManifest.Read(infrastructurePath);
        if (builder.ExecutionContext.IsPublishMode)
        {
            var deploymentResource = new FlarestackPlatformResource(name, infrastructurePath, mode, manifest, null, null, builder);
            var deployment = builder.AddResource(deploymentResource).ExcludeFromManifest();
            FlarestackDeploymentPipeline.Configure(deployment);
            return deployment;
        }

        var settings = FlarestackLocalSettings.Read(manifest.ConfigurationPath, infrastructurePath);
        var token = builder.AddParameter(
            $"{name}-bridge-token",
            () => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            secret: true);
        var resource = new FlarestackPlatformResource(name, infrastructurePath, mode, manifest, settings, token, builder);
        var platform = builder.AddResource(resource)
            .WithArgs(manifest.DevelopmentCommand[1..])
            .WithEnvironment("PUBLIC_ORIGIN", settings.PublicOrigin)
            .WithEnvironment("FLARESTACK_EXTERNAL_OTLP", "1")
            .WithEnvironment("FLARESTACK_ADMIN_USER_IDS",
                builder.Configuration["Flarestack:AdminUserIds"] ??
                Environment.GetEnvironmentVariable("FLARESTACK_ADMIN_USER_IDS") ?? "")
            .WithEnvironment("FLARESTACK_LOCAL_MODE", mode.ToString())
            .WithEnvironment("FLARESTACK_LOCAL_BRIDGE_TOKEN", token)
            .WithHttpEndpoint(port: settings.ListenerOrigin.Port, targetPort: settings.ListenerOrigin.Port, name: "http", isProxied: false)
            .WithHttpEndpoint(port: settings.InboxPort, targetPort: settings.InboxPort, name: "inbox", isProxied: false)
            .WithHttpHealthCheck("/_flarestack/ready", endpointName: "http")
            .WithOtlpExporter(OtlpProtocol.HttpProtobuf);

        if (mode == FlarestackLocalMode.Fast)
        {
            platform.WithHttpEndpoint(port: settings.BridgePort, targetPort: settings.BridgePort, name: "bridge", isProxied: false);
        }

        return platform;
    }

    internal static void AttachApplication(IResourceBuilder<FlarestackPlatformResource> platform, string name)
    {
        var resource = platform.Resource;
        if (resource.Mode == FlarestackLocalMode.Fast && platform.ApplicationBuilder.ExecutionContext.IsRunMode)
        {
            var settings = resource.Settings ?? throw new InvalidOperationException("Local Flarestack settings are missing.");
            var bridgeToken = resource.BridgeToken ?? throw new InvalidOperationException("Local Flarestack bridge parameter is missing.");
            var application = platform.ApplicationBuilder.AddExecutable(
                    name, resource.Manifest.WatchCommand[0], resource.WorkingDirectory, resource.Manifest.WatchCommand[1..])
                .WithHttpEndpoint(name: "http", isProxied: false)
                .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
                .WithEnvironment("Flarestack__Authentication__Authority", settings.PublicOrigin + "/auth")
                .WithEnvironment("Flarestack__D1__BaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__Email__BaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__Authentication__BackchannelBaseAddress", platform.GetEndpoint("bridge"))
                .WithEnvironment("Flarestack__LocalBridgeToken", bridgeToken)
                .WithOtlpExporter(OtlpProtocol.HttpProtobuf)
                .WithHttpHealthCheck("/health")
                .WaitFor(platform);
            application.WithEnvironment("ASPNETCORE_URLS", application.GetEndpoint("http"));
            platform.WithEnvironment("FLARESTACK_LOCAL_ORIGIN", application.GetEndpoint("http"));
            resource.ApplicationResource = application;
        }

        resource.IsApplicationAttached = true;
    }
}
