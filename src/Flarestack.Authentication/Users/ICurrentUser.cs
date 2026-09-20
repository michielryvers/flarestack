using System.Security.Claims;

namespace Flarestack.Authentication.Users;

/// <summary>Resolves the current HTTP/circuit identity and checks its live auth session. No validation cache.</summary>
public interface ICurrentUser
{
    Task<ClaimsPrincipal> GetPrincipalAsync(CancellationToken cancellationToken = default);
    async Task<string> GetRequiredIdAsync(CancellationToken cancellationToken = default) =>
        (await GetPrincipalAsync(cancellationToken)).FindFirstValue("sub") ?? throw new UnauthorizedAccessException();
}
