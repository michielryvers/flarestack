namespace Flarestack.Email;

/// <summary>Configures the private email binding client.</summary>
public sealed class EmailOptions
{
    /// <summary>The configuration section for the email client.</summary>
    public const string SectionName = "Flarestack:Email";

    /// <summary>An absolute HTTP or HTTPS address. Local bridge credentials require loopback.</summary>
    public string BaseAddress { get; set; } = "http://email.internal";

    /// <summary>
    /// The request timeout, defaulting to 30 seconds. Accepts a positive duration up to
    /// <see cref="int.MaxValue"/> milliseconds, or <see cref="System.Threading.Timeout.InfiniteTimeSpan"/>.
    /// </summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
}
