using System.Net.Http.Json;
using System.Security.Claims;
using Flarestack.Authentication.Administration;
using Flarestack.Authentication.Sessions;
using Microsoft.Extensions.Logging;

namespace Flarestack.Authentication.Transport;

/// <summary>Communicates with the private authentication service.</summary>
public sealed class AccountClient(HttpClient client, ILogger<AccountClient> logger)
{
    private const int MaximumValidationAttempts = 3;
    private static readonly TimeSpan ValidationTimeout = TimeSpan.FromSeconds(10);

    private static Dictionary<string, object?> CreateIdentityPayload(ClaimsPrincipal actor) => new()
    {
        ["userId"] = actor.FindFirstValue("sub"),
        ["sessionId"] = actor.FindFirstValue("sid")
    };

    /// <summary>Validates the actor against the live session, returning null for failed validation.</summary>
    public async Task<AccountSession?> ValidateAsync(
        ClaimsPrincipal actor,
        CancellationToken cancellationToken = default)
    {
        if (actor.Identity?.IsAuthenticated != true || !actor.HasClaim(c => c.Type == "sid"))
        {
            return null;
        }

        // Validation is a read. Retry transient transport/5xx failures without ever
        // accepting cached identity, and keep all attempts inside the existing 10s budget.
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(ValidationTimeout);

        try
        {
            for (var attempt = 0; attempt < MaximumValidationAttempts; attempt++)
            {
                try
                {
                    using var response = await client.PostAsJsonAsync(
                        "/_flarestack/internal/session",
                        CreateIdentityPayload(actor),
                        budget.Token);
                    if (response.Headers.Contains("x-flarestack-protocol"))
                    {
                        Internal.Protocol.Ensure(response, "Flarestack.Authentication");
                    }

                    if ((int)response.StatusCode < 500)
                    {
                        Internal.Protocol.Ensure(response, "Flarestack.Authentication");
                        if (!response.IsSuccessStatusCode)
                        {
                            return null;
                        }

                        var session = await response.Content.ReadFromJsonAsync<AccountSession>(budget.Token);
                        return session is not null
                            && session.Id == actor.FindFirstValue("sub")
                            && session.Roles is not null
                            && session.Email is not null
                            && session.Name is not null
                            ? session
                            : null;
                    }

                    if (attempt == MaximumValidationAttempts - 1)
                    {
                        return null;
                    }
                }
                catch (HttpRequestException) when (attempt < MaximumValidationAttempts - 1)
                {
                    await DelayBeforeRetryAsync(attempt, budget.Token);
                    continue;
                }

                await DelayBeforeRetryAsync(attempt, budget.Token);
            }

            return null;
        }
        catch (Internal.ProtocolMismatchException error)
        {
            logger.LogError("{ProtocolError}", error.Message);
            return null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    private async Task DelayBeforeRetryAsync(int attempt, CancellationToken cancellationToken)
    {
        logger.LogWarning(
            "Live session lookup temporarily unavailable; retrying read (attempt {Attempt})",
            attempt + 2);
        await Task.Delay(TimeSpan.FromMilliseconds(100 * (attempt + 1)), cancellationToken);
    }

    internal async Task<UserPage> ListAsync(
        ClaimsPrincipal actor,
        string search = "",
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var body = CreateIdentityPayload(actor);
        body["search"] = search;
        body["offset"] = offset;

        using var response = await client.PostAsJsonAsync("/_flarestack/internal/users", body, cancellationToken);
        Internal.Protocol.Ensure(response, "Flarestack.Authentication");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<UserPage>(cancellationToken))!;
    }

    private async Task UpdateAsync(
        ClaimsPrincipal actor,
        string userId,
        string operation,
        string? role,
        CancellationToken cancellationToken)
    {
        var body = CreateIdentityPayload(actor);
        body["targetUserId"] = userId;
        body["role"] = role;

        using var response = await client.PostAsJsonAsync($"/_flarestack/internal/{operation}", body, cancellationToken);
        Internal.Protocol.Ensure(response, "Flarestack.Authentication");
        response.EnsureSuccessStatusCode();
    }

    internal Task SetRoleAsync(
        ClaimsPrincipal actor,
        string userId,
        string role,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(actor, userId, "role", role, cancellationToken);

    internal Task SetDisabledAsync(
        ClaimsPrincipal actor,
        string userId,
        bool disabled,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(actor, userId, disabled ? "ban" : "unban", null, cancellationToken);

    internal Task RevokeSessionsAsync(
        ClaimsPrincipal actor,
        string userId,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(actor, userId, "revoke", null, cancellationToken);
}
