using System.Security.Claims;
using Flarestack.Authentication.Transport;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Http;

namespace Flarestack.Authentication.Users;

internal sealed class CurrentUser(IHttpContextAccessor http, AuthenticationStateProvider state, AccountClient accounts) : ICurrentUser
{
    public async Task<ClaimsPrincipal> GetPrincipalAsync(CancellationToken cancellationToken = default)
    {
        ClaimsPrincipal principal;
        // During a circuit, HttpContext can be stale. Prefer the circuit provider.
        try
        {
            principal = (await state.GetAuthenticationStateAsync()).User;
        }
        catch (InvalidOperationException)
        {
            principal = http.HttpContext?.User ?? new ClaimsPrincipal();
        }

        var session = await accounts.ValidateAsync(principal, cancellationToken);
        if (session is null)
        {
            throw new UnauthorizedAccessException("A live authenticated session is required.");
        }

        var identity = new ClaimsIdentity(principal.Identity as ClaimsIdentity ?? new ClaimsIdentity());
        foreach (var role in identity.FindAll("role").ToArray())
        {
            identity.RemoveClaim(role);
        }
        foreach (var role in session.Roles)
        {
            identity.AddClaim(new("role", role));
        }

        return new ClaimsPrincipal(identity);
    }
}
