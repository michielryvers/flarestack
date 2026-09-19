using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Server;
using Microsoft.Extensions.Logging;

namespace Flarestack.Authentication;

public sealed record AccountSession(string Id, string Email, string Name, string[] Roles);
public sealed record AdminUser(string Id, string Email, string Name, string Role, bool Banned);
public sealed record UserPage(AdminUser[] Users, int Total);
public interface IUserAdministration
{
    Task<UserPage> ListAsync(ClaimsPrincipal actor, string search = "", int offset = 0, CancellationToken cancellationToken = default);
    Task SetRoleAsync(ClaimsPrincipal actor, string userId, string role, CancellationToken cancellationToken = default);
    Task SetDisabledAsync(ClaimsPrincipal actor, string userId, bool disabled, CancellationToken cancellationToken = default);
    Task RevokeSessionsAsync(ClaimsPrincipal actor, string userId, CancellationToken cancellationToken = default);
}
public sealed class AccountClient(HttpClient client) : IUserAdministration
{
    private static Dictionary<string, object?> Identity(ClaimsPrincipal actor) => new() {
        ["userId"] = actor.FindFirstValue("sub"), ["sessionId"] = actor.FindFirstValue("sid")
    };
    public async Task<AccountSession?> ValidateAsync(ClaimsPrincipal actor, CancellationToken cancellationToken = default)
    {
        if (actor.Identity?.IsAuthenticated != true || !actor.HasClaim(c => c.Type == "sid")) return null;
        try {
            using var response = await client.PostAsJsonAsync("/_flarestack/internal/session", Identity(actor), cancellationToken);
            return response.IsSuccessStatusCode ? await response.Content.ReadFromJsonAsync<AccountSession>(cancellationToken) : null;
        } catch (HttpRequestException) { return null; } catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }
    public async Task<UserPage> ListAsync(ClaimsPrincipal actor, string search = "", int offset = 0, CancellationToken cancellationToken = default)
    {
        var body = Identity(actor); body["search"] = search; body["offset"] = offset;
        using var response = await client.PostAsJsonAsync("/_flarestack/internal/users", body, cancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<UserPage>(cancellationToken))!;
    }
    private async Task Update(ClaimsPrincipal actor, string userId, string operation, string? role, CancellationToken cancellationToken)
    {
        var body = Identity(actor); body["targetUserId"] = userId; body["role"] = role;
        using var response = await client.PostAsJsonAsync($"/_flarestack/internal/{operation}", body, cancellationToken);
        response.EnsureSuccessStatusCode();
    }
    public Task SetRoleAsync(ClaimsPrincipal actor, string userId, string role, CancellationToken cancellationToken = default) => Update(actor,userId,"role",role,cancellationToken);
    public Task SetDisabledAsync(ClaimsPrincipal actor, string userId, bool disabled, CancellationToken cancellationToken = default) => Update(actor,userId,disabled ? "ban" : "unban",null,cancellationToken);
    public Task RevokeSessionsAsync(ClaimsPrincipal actor, string userId, CancellationToken cancellationToken = default) => Update(actor,userId,"revoke",null,cancellationToken);
}

public sealed class FlarestackAuthenticationStateProvider(ILoggerFactory loggerFactory, AccountClient client)
    : RevalidatingServerAuthenticationStateProvider(loggerFactory)
{
    // HTTP cookies are checked on every request. Existing circuits fail closed
    // within this interval; changed roles require fresh authentication state.
    protected override TimeSpan RevalidationInterval => TimeSpan.FromSeconds(30);
    protected override async Task<bool> ValidateAuthenticationStateAsync(AuthenticationState state, CancellationToken cancellationToken)
    {
        var session = await client.ValidateAsync(state.User, cancellationToken);
        return session is not null && session.Roles.Order().SequenceEqual(state.User.FindAll("role").Select(c => c.Value).Order());
    }
}
