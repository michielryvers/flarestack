namespace Flarestack.D1;

/// <summary>Configures the D1 client through the Flarestack:D1 configuration section.</summary>
public sealed class D1Options
{
    /// <summary>The configuration section bound by D1 registration.</summary>
    public const string SectionName = "Flarestack:D1";

    /// <summary>The absolute HTTP or HTTPS address of the private D1 binding.</summary>
    public string BaseAddress { get; set; } = "http://d1.internal";
    /// <summary>The request timeout in seconds. Options-based registration accepts 1 through 2147483.</summary>
    public int TimeoutSeconds { get; set; } = 30;
    /// <summary>The maximum serialized request size in bytes. Must be positive.</summary>
    public int MaxRequestBytes { get; set; } = 1_048_576;
    /// <summary>The maximum number of commands in a batch. Must be positive.</summary>
    public int MaxCommands { get; set; } = 100;
    /// <summary>Includes SQL text in traces when enabled. Bound parameter values are never included.</summary>
    public bool IncludeSqlInTraces { get; set; }
}
