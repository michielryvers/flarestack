using System.Security.Claims;
using Flarestack.Authentication.Transport;
using Flarestack.Authentication.Users;
using Microsoft.AspNetCore.Authorization;

namespace Flarestack.Authentication.Administration;

internal sealed class UserAdministration(
    AccountClient client,
    ICurrentUser currentUser,
    IAuthorizationService authorization) : IUserAdministration
{
    private async Task<ClaimsPrincipal> GetAuthorizedActorAsync(CancellationToken cancellationToken)
    {
        var actor = await currentUser.GetPrincipalAsync(cancellationToken);
        if (!(await authorization.AuthorizeAsync(actor, null, FlarestackPolicies.Administration)).Succeeded)
        {
            throw new UnauthorizedAccessException("Administrator permission is required.");
        }

        return actor;
    }

    public async Task<UserPage> ListAsync(
        string search = "",
        int offset = 0,
        CancellationToken cancellationToken = default) =>
        await client.ListAsync(await GetAuthorizedActorAsync(cancellationToken), search, offset, cancellationToken);

    public async Task SetRoleAsync(
        string userId,
        UserRole role,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(role))
        {
            throw new ArgumentOutOfRangeException(nameof(role));
        }

        await client.SetRoleAsync(
            await GetAuthorizedActorAsync(cancellationToken),
            userId,
            role == UserRole.Admin ? "admin" : "user",
            cancellationToken);
    }

    public async Task SetDisabledAsync(
        string userId,
        bool disabled,
        CancellationToken cancellationToken = default) =>
        await client.SetDisabledAsync(await GetAuthorizedActorAsync(cancellationToken), userId, disabled, cancellationToken);

    public async Task RevokeSessionsAsync(
        string userId,
        CancellationToken cancellationToken = default) =>
        await client.RevokeSessionsAsync(await GetAuthorizedActorAsync(cancellationToken), userId, cancellationToken);
}
