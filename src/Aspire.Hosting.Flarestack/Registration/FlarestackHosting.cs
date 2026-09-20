using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Resources;

namespace Aspire.Hosting.Flarestack.Registration;

/// <summary>Registers the local Flarestack resource graph with Aspire.</summary>
public static class FlarestackHosting
{
    /// <summary>Adds the Alchemy supervisor and, in fast mode, the traced .NET watcher.</summary>
    /// <param name="builder">The Aspire application builder.</param>
    /// <param name="name">The resource name of the Alchemy supervisor.</param>
    /// <param name="infrastructureDirectory">The infrastructure directory, relative to the AppHost directory or absolute.</param>
    /// <param name="configure">An optional callback to configure local mode and the application resource name.</param>
    /// <returns>The supervisor and optional fast-mode application resources.</returns>
    public static FlarestackResources AddFlarestack(
        this IDistributedApplicationBuilder builder,
        string name,
        string infrastructureDirectory,
        Action<FlarestackOptions>? configure = null)
    {
        var options = new FlarestackOptions();
        configure?.Invoke(options);
        if (!Enum.IsDefined(options.Mode))
        {
            throw new ArgumentException("Mode must be Fast or Container.", nameof(options));
        }

        var platform = FlarestackResourceComposition.AddPlatform(builder, name, infrastructureDirectory, options.Mode);
        FlarestackResourceComposition.AttachApplication(platform, options.ApplicationName);
        return new FlarestackResources(platform, platform.Resource.ApplicationResource);
    }

    /// <summary>Adds the typed Alchemy supervisor without starting a separate application process.</summary>
    /// <param name="builder">The Aspire application builder.</param>
    /// <param name="name">The resource name of the Alchemy supervisor.</param>
    /// <param name="infrastructureDirectory">The infrastructure directory, relative to the AppHost directory or absolute.</param>
    /// <param name="mode">The immutable local execution mode. Defaults to fast mode.</param>
    /// <returns>The platform builder, supporting standard Aspire endpoints and environment configuration.</returns>
    /// <remarks>Fast mode requires <see cref="WithApplication"/> before startup. Alchemy owns the Container-mode application.</remarks>
    public static IResourceBuilder<FlarestackPlatformResource> AddFlarestackPlatform(
        this IDistributedApplicationBuilder builder,
        string name,
        string infrastructureDirectory,
        FlarestackLocalMode mode = FlarestackLocalMode.Fast)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(infrastructureDirectory);
        if (!Enum.IsDefined(mode))
        {
            throw new ArgumentException("Mode must be Fast or Container.", nameof(mode));
        }

        ValidateApplicationName(builder, name);
        var platform = FlarestackResourceComposition.AddPlatform(builder, name, infrastructureDirectory, mode);
        builder.Eventing.Subscribe<BeforeStartEvent>((@event, cancellationToken) =>
        {
            if (mode == FlarestackLocalMode.Fast && !platform.Resource.IsApplicationAttached)
            {
                throw new InvalidOperationException("Fast-mode Flarestack requires WithApplication before startup.");
            }

            return Task.CompletedTask;
        });
        return platform;
    }

    /// <summary>Attaches the application declared by the infrastructure manifest exactly once.</summary>
    /// <param name="platform">The platform builder returned by <see cref="AddFlarestackPlatform"/>.</param>
    /// <param name="name">The Aspire resource name of the fast-mode watcher, validated in both modes.</param>
    /// <returns>The same platform builder.</returns>
    /// <remarks>
    /// Fast mode adds the manifest's traced watch command. Container mode retains the Alchemy-owned application
    /// and adds no executable or container. This method does not attach an arbitrary project or change the manifest.
    /// </remarks>
    public static IResourceBuilder<FlarestackPlatformResource> WithApplication(
        this IResourceBuilder<FlarestackPlatformResource> platform,
        string name = "app")
    {
        ArgumentNullException.ThrowIfNull(platform);
        if (!ReferenceEquals(platform.ApplicationBuilder, platform.Resource.ApplicationBuilder))
        {
            throw new InvalidOperationException("The Flarestack platform belongs to another application builder.");
        }

        if (platform.Resource.IsApplicationAttached)
        {
            throw new InvalidOperationException("The Flarestack platform already has an application attached.");
        }

        ValidateApplicationName(platform.ApplicationBuilder, name);
        FlarestackResourceComposition.AttachApplication(platform, name);
        return platform;
    }

    private static void ValidateApplicationName(IDistributedApplicationBuilder builder, string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        // Match Aspire's default resource naming policy before mutating the attachment state, including Container mode.
        if (name.Length > 64 || !char.IsAsciiLetter(name[0]) || name[^1] == '-' ||
            name.Contains("--", StringComparison.Ordinal) || name.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-'))
        {
            throw new ArgumentException("Resource names must follow Aspire's default resource naming policy.", nameof(name));
        }

        if (builder.Resources.Any(resource => string.Equals(resource.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            throw new ArgumentException("A resource with this name already exists.", nameof(name));
        }
    }
}
