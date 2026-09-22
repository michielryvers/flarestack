using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Resources;

namespace Aspire.Hosting.Flarestack;

/// <summary>Provides the conventional Flarestack setup for a local or deployed Aspire application.</summary>
public static class FlarestackHostingExtensions
{
    /// <summary>Registers Flarestack using configuration and applies local dashboard settings to this builder.</summary>
    /// <param name="builder">The Aspire application builder.</param>
    /// <param name="name">The Alchemy platform resource name.</param>
    /// <param name="infrastructureDirectory">The infrastructure directory, relative to the AppHost directory or absolute.</param>
    /// <returns>The platform and optional fast-mode watcher.</returns>
    /// <remarks>
    /// Local setup reads Flarestack:LocalMode (Fast by default) and Flarestack:ApplicationName
    /// (the platform name with an -app suffix by default). Publish mode does not read local settings.
    /// Machine dashboard ports override launch settings; explicit command-line endpoints take precedence.
    /// </remarks>
    public static FlarestackResources AddFlarestack(
        this IDistributedApplicationBuilder builder,
        string name,
        string infrastructureDirectory)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(infrastructureDirectory);

        var mode = FlarestackLocalMode.Fast;
        var applicationName = $"{name}-app";
        if (builder.ExecutionContext.IsRunMode)
        {
            var configuredMode = builder.Configuration["Flarestack:LocalMode"] ?? "Fast";
            if (!Enum.TryParse(configuredMode, ignoreCase: true, out mode) || !Enum.IsDefined(mode))
            {
                throw new InvalidOperationException("Flarestack:LocalMode must be Fast or Container.");
            }

            applicationName = builder.Configuration["Flarestack:ApplicationName"] ?? applicationName;
        }

        var resources = Registration.FlarestackHosting.AddFlarestack(builder, name, infrastructureDirectory, options =>
        {
            options.Mode = mode;
            options.ApplicationName = applicationName;
        });

        if (builder.ExecutionContext.IsRunMode)
        {
            var platform = (FlarestackPlatformResource)resources.Platform.Resource;
            FlarestackLocalEndpoints.Apply(builder.Configuration, platform.Manifest.ConfigurationPath);
        }

        return resources;
    }
}
