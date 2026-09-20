namespace Flarestack.Authentication.Configuration;

/// <summary>Configures the public identity provider and optional private backchannel route.</summary>
public sealed class AuthenticationOptions
{
    /// <summary>The configuration section bound by authentication registration.</summary>
    public const string SectionName = "Flarestack:Authentication";

    /// <summary>The absolute HTTPS authority, or HTTP loopback authority in Development.</summary>
    public string Authority { get; set; } = string.Empty;

    /// <summary>The registered OpenID Connect client identifier.</summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>The optional HTTP(S) private route. Null leaves OIDC routing unchanged and uses auth.internal for account operations.</summary>
    public string? BackchannelBaseAddress { get; set; }
}
