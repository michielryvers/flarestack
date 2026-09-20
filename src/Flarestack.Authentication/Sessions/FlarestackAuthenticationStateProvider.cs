using Flarestack.Authentication.Transport;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Server;
using Microsoft.Extensions.Logging;

namespace Flarestack.Authentication.Sessions;

/// <summary>Revalidates live sessions for interactive server circuits.</summary>
public sealed class FlarestackAuthenticationStateProvider(ILoggerFactory loggerFactory, AccountClient client)
    : RevalidatingServerAuthenticationStateProvider(loggerFactory)
{
    // HTTP cookies are checked on every request. Existing circuits fail closed
    // after the interval plus lookup timeout; changed roles require fresh authentication state.
    protected override TimeSpan RevalidationInterval => TimeSpan.FromSeconds(30);
    protected override async Task<bool> ValidateAuthenticationStateAsync(AuthenticationState state, CancellationToken cancellationToken)
    {
        var session = await client.ValidateAsync(state.User, cancellationToken);
        return session is not null && session.Roles.Order().SequenceEqual(state.User.FindAll("role").Select(c => c.Value).Order());
    }
}
