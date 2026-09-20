using Microsoft.Extensions.Options;

namespace Flarestack.Email;

internal sealed class EmailOptionsValidator(bool requiresLoopback) : IValidateOptions<EmailOptions>
{
    public ValidateOptionsResult Validate(string? name, EmailOptions options)
    {
        if (name is not null && name != Options.DefaultName)
        {
            return ValidateOptionsResult.Skip;
        }

        if (!Uri.TryCreate(options.BaseAddress, UriKind.Absolute, out var address) ||
            address.Scheme is not ("http" or "https"))
        {
            return ValidateOptionsResult.Fail("Email BaseAddress must be an absolute HTTP or HTTPS address.");
        }

        if (requiresLoopback && !address.IsLoopback)
        {
            return ValidateOptionsResult.Fail("Email BaseAddress must be loopback when local bridge credentials are configured.");
        }

        if (options.Timeout != Timeout.InfiniteTimeSpan &&
            (options.Timeout <= TimeSpan.Zero || options.Timeout > TimeSpan.FromMilliseconds(int.MaxValue)))
        {
            return ValidateOptionsResult.Fail("Email Timeout must be positive and at most 2147483647 milliseconds, or InfiniteTimeSpan.");
        }

        return ValidateOptionsResult.Success;
    }
}
