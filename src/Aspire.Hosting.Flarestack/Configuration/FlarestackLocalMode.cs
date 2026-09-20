namespace Aspire.Hosting.Flarestack.Configuration;

/// <summary>Determines where the local .NET application runs.</summary>
public enum FlarestackLocalMode
{
    /// <summary>Run a .NET watcher on the host alongside the Alchemy supervisor.</summary>
    Fast,

    /// <summary>Let Alchemy run the .NET application in a container.</summary>
    Container
}
