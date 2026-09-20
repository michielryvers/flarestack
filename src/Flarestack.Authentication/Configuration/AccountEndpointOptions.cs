namespace Flarestack.Authentication.Configuration;

/// <summary>Configures the account login endpoint.</summary>
public sealed class AccountEndpointOptions
{
    /// <summary>Gets or sets the local path used when a login return URL is absent or invalid.</summary>
    public string DefaultReturnPath { get; set; } = "/";
}
