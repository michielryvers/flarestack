namespace Flarestack.Authentication.Administration;

/// <summary>Administers users on behalf of the current, authorized administrator.</summary>
public interface IUserAdministration
{
    Task<UserPage> ListAsync(string search = "", int offset = 0, CancellationToken cancellationToken = default);
    Task SetRoleAsync(string userId, UserRole role, CancellationToken cancellationToken = default);
    Task SetDisabledAsync(string userId, bool disabled, CancellationToken cancellationToken = default);
    Task RevokeSessionsAsync(string userId, CancellationToken cancellationToken = default);
}
