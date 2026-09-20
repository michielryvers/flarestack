using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Flarestack.Authentication.Configuration;

internal sealed class AuthenticationOptionsValidator(IHostEnvironment environment, string? bridgeToken)
    : IValidateOptions<AuthenticationOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthenticationOptions options)
    {
        var failures = new List<string>();
        if (!TryHttpAddress(options.Authority, out var authority))
        {
            failures.Add("Authentication Authority must be an absolute HTTP(S) address.");
        }
        else if (authority!.IsLoopback && !environment.IsDevelopment())
        {
            failures.Add("Loopback authority is permitted only in Development.");
        }
        else if (authority.Scheme == "http" && !authority.IsLoopback)
        {
            failures.Add("HTTP authority is permitted only for loopback Development.");
        }

        if (string.IsNullOrWhiteSpace(options.ClientId))
        {
            failures.Add("Authentication ClientId is required.");
        }

        if (!TryHttpAddress(options.BackchannelBaseAddress ?? "http://auth.internal", out var backchannel))
        {
            failures.Add("Authentication BackchannelBaseAddress must be an absolute HTTP(S) address.");
        }
        else if (!string.IsNullOrEmpty(bridgeToken) && !backchannel!.IsLoopback)
        {
            failures.Add("Local bridge credentials require a loopback address.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static bool TryHttpAddress(string? value, out Uri? address)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out address)
            && (address.Scheme == "https" || address.Scheme == "http");
    }
}
