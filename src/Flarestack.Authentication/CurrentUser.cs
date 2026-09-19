using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Http;

namespace Flarestack.Authentication;

/// <summary>Resolves the current HTTP/circuit identity and checks its live auth session. No validation cache.</summary>
public interface ICurrentUser
{
    Task<ClaimsPrincipal> GetPrincipalAsync(CancellationToken cancellationToken = default);
    async Task<string> GetRequiredIdAsync(CancellationToken cancellationToken = default) =>
        (await GetPrincipalAsync(cancellationToken)).FindFirstValue("sub") ?? throw new UnauthorizedAccessException();
}
internal sealed class CurrentUser(IHttpContextAccessor http, AuthenticationStateProvider state, AccountClient accounts) : ICurrentUser
{
    public async Task<ClaimsPrincipal> GetPrincipalAsync(CancellationToken cancellationToken = default)
    {
        ClaimsPrincipal principal;
        // During a circuit, HttpContext can be stale. Prefer the circuit provider.
        try { principal = (await state.GetAuthenticationStateAsync()).User; }
        catch (InvalidOperationException) { principal = http.HttpContext?.User ?? new ClaimsPrincipal(); }
        var session = await accounts.ValidateAsync(principal, cancellationToken);
        if (session is null) throw new UnauthorizedAccessException("A live authenticated session is required.");
        var identity = new ClaimsIdentity(principal.Identity as ClaimsIdentity ?? new ClaimsIdentity());
        foreach (var role in identity.FindAll("role").ToArray()) identity.RemoveClaim(role);
        foreach (var role in session.Roles) identity.AddClaim(new("role", role));
        return new ClaimsPrincipal(identity);
    }
}
public enum UserRole { User, Admin }
public static class FlarestackPolicies { public const string Administration = "Flarestack.Administration"; }
internal sealed class UserAdministration(AccountClient client, ICurrentUser currentUser, IAuthorizationService authorization) : IUserAdministration
{
    private async Task<ClaimsPrincipal> Actor(CancellationToken ct)
    {
        var actor = await currentUser.GetPrincipalAsync(ct);
        if (!(await authorization.AuthorizeAsync(actor, null, FlarestackPolicies.Administration)).Succeeded)
            throw new UnauthorizedAccessException("Administrator permission is required.");
        return actor;
    }
    public async Task<UserPage> ListAsync(string search = "", int offset = 0, CancellationToken cancellationToken = default) =>
        await client.ListAsync(await Actor(cancellationToken), search, offset, cancellationToken);
    public async Task SetRoleAsync(string userId, UserRole role, CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(role)) throw new ArgumentOutOfRangeException(nameof(role));
        await client.SetRoleAsync(await Actor(cancellationToken), userId, role == UserRole.Admin ? "admin" : "user", cancellationToken);
    }
    public async Task SetDisabledAsync(string userId, bool disabled, CancellationToken cancellationToken = default) =>
        await client.SetDisabledAsync(await Actor(cancellationToken), userId, disabled, cancellationToken);
    public async Task RevokeSessionsAsync(string userId, CancellationToken cancellationToken = default) =>
        await client.RevokeSessionsAsync(await Actor(cancellationToken), userId, cancellationToken);
}
