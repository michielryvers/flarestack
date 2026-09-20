using Aspire.Hosting.ApplicationModel;

namespace Aspire.Hosting.Flarestack.Resources;

/// <summary>The local resources registered for Flarestack.</summary>
/// <param name="Platform">The Alchemy supervisor that owns infrastructure and containers.</param>
/// <param name="Application">The .NET watcher in fast mode; otherwise <see langword="null"/>.</param>
public sealed record FlarestackResources(
    IResourceBuilder<ExecutableResource> Platform,
    IResourceBuilder<ExecutableResource>? Application);
