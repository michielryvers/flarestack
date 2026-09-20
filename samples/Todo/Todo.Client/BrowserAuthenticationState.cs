using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;

namespace Todo.Client;

// UI state only. Every API request independently validates the HttpOnly cookie on the server.
public sealed class BrowserAuthenticationState(HttpClient http) : AuthenticationStateProvider, IDisposable
{
    private AuthenticationState _state = new(new ClaimsPrincipal(new ClaimsIdentity()));
    private Task<AuthenticationState>? _initial;
    private string? _requestToken;
    private string? _userId;
    private readonly CancellationTokenSource _stop = new();

    public override async Task<AuthenticationState> GetAuthenticationStateAsync()
    {
        await (_initial ??= InitializeAsync());
        return _state;
    }

    private async Task<AuthenticationState> InitializeAsync()
    {
        await RefreshAsync();
        _ = RevalidateAsync();
        return _state;
    }

    public async Task<string> GetRequestTokenAsync()
    {
        await GetAuthenticationStateAsync();
        return _requestToken ?? throw new UnauthorizedAccessException();
    }

    public void Invalidate()
    {
        _requestToken = null;
        _state = new(new ClaimsPrincipal(new ClaimsIdentity()));
        NotifyAuthenticationStateChanged(Task.FromResult(_state));
    }

    public async Task RefreshAsync()
    {
        try
        {
            var session = await http.GetFromJsonAsync<BrowserSession>("api/session", _stop.Token)
                ?? throw new HttpRequestException();
            if (string.IsNullOrEmpty(session.Id) || session.Name is null || session.Email is null ||
                session.Roles is null || session.Roles.Any(string.IsNullOrEmpty) || string.IsNullOrEmpty(session.RequestToken))
                throw new System.Text.Json.JsonException("Invalid session response.");
            // A different account in another tab must not inherit this page's cached tasks.
            // Reload creates a new client instance and loads that account's workspace.
            if (_userId is not null && _userId != session.Id) { Invalidate(); return; }
            _userId = session.Id;
            List<Claim> claims = [new("sub", session.Id), new("name", session.Name), new("email", session.Email)];
            claims.AddRange(session.Roles.Select(role => new Claim("role", role)));
            _requestToken = session.RequestToken;
            _state = new(new ClaimsPrincipal(new ClaimsIdentity(claims, "ServerSession", "name", "role")));
            NotifyAuthenticationStateChanged(Task.FromResult(_state));
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException)
        {
            Invalidate();
        }
    }

    private async Task RevalidateAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(_stop.Token)) await RefreshAsync();
        }
        catch (OperationCanceledException) { }
    }

    public void Dispose() { _stop.Cancel(); _stop.Dispose(); }
}
