namespace Aspire.Hosting.Flarestack.Configuration;

/// <summary>Options for adding Flarestack resources to an Aspire application.</summary>
public sealed class FlarestackOptions
{
    /// <summary>Gets or sets the local execution mode. Defaults to fast mode.</summary>
    public FlarestackLocalMode Mode { get; set; } = FlarestackLocalMode.Fast;

    /// <summary>Gets or sets the Aspire resource name of the fast-mode .NET watcher.</summary>
    public string ApplicationName { get; set; } = "app";
}
