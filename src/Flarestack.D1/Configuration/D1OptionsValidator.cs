using Microsoft.Extensions.Options;

namespace Flarestack.D1;

internal sealed class D1OptionsValidator(bool requiresLoopback) : IValidateOptions<D1Options>
{
    public ValidateOptionsResult Validate(string? name, D1Options options)
    {
        if (name is not null && name != Options.DefaultName)
        {
            return ValidateOptionsResult.Skip;
        }

        if (!Uri.TryCreate(options.BaseAddress, UriKind.Absolute, out var address) ||
            address.Scheme is not ("http" or "https"))
        {
            return ValidateOptionsResult.Fail("D1 BaseAddress must be an absolute HTTP or HTTPS address.");
        }

        if (requiresLoopback && !address.IsLoopback)
        {
            return ValidateOptionsResult.Fail("D1 BaseAddress must be loopback when local bridge credentials are configured.");
        }

        if (options.TimeoutSeconds is <= 0 or > int.MaxValue / 1000)
        {
            return ValidateOptionsResult.Fail("D1 TimeoutSeconds must be between 1 and 2147483.");
        }

        if (options.MaxCommands <= 0 || options.MaxRequestBytes <= 0)
        {
            return ValidateOptionsResult.Fail("D1 MaxCommands and MaxRequestBytes must be positive.");
        }

        return ValidateOptionsResult.Success;
    }
}
