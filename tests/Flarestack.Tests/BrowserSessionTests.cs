using System.Net;
using System.Net.Http.Json;
using Todo.Client;
using Xunit;

namespace Flarestack.Tests;

public class BrowserSessionTests
{
    private sealed class Handler : HttpMessageHandler
    {
        public HttpStatusCode SessionStatus = HttpStatusCode.OK;
        public HttpStatusCode WriteStatus = HttpStatusCode.NoContent;
        public string? RequestToken;
        public bool Malformed;
        public string UserId = "user-1";
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsolutePath == "/api/session")
                return Task.FromResult(new HttpResponseMessage(SessionStatus)
                {
                    Content = Malformed ? new StringContent("{}", System.Text.Encoding.UTF8, "application/json") : JsonContent.Create(new BrowserSession(UserId, "Name", "test@example.test", ["user"], "csrf-test-token"))
                });
            RequestToken = request.Headers.TryGetValues("RequestVerificationToken", out var values) ? values.Single() : null;
            return Task.FromResult(new HttpResponseMessage(WriteStatus));
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task ApiRejectionClearsBrowserIdentityAndDoesNotReuseInitialState(HttpStatusCode status)
    {
        var handler = new Handler { WriteStatus = status };
        using var http = new HttpClient(handler) { BaseAddress = new("https://app.test") };
        using var state = new BrowserAuthenticationState(http);
        Assert.True((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
        var service = new HttpTodoService(http, state);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.AddAsync("test"));
        Assert.Equal("csrf-test-token", handler.RequestToken);
        Assert.False((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => state.GetRequestTokenAsync());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task UnavailableSessionFailsClosed(HttpStatusCode status)
    {
        using var http = new HttpClient(new Handler { SessionStatus = status }) { BaseAddress = new("https://app.test") };
        using var state = new BrowserAuthenticationState(http);
        Assert.False((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => state.GetRequestTokenAsync());
    }

    [Fact]
    public async Task MalformedSessionFailsClosed()
    {
        using var http = new HttpClient(new Handler { Malformed = true }) { BaseAddress = new("https://app.test") };
        using var state = new BrowserAuthenticationState(http);
        Assert.False((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
    }

    [Fact]
    public async Task SwitchingAccountsRequiresReloadBeforeReusingTheWorkspace()
    {
        var handler = new Handler();
        using var http = new HttpClient(handler) { BaseAddress = new("https://app.test") };
        using var state = new BrowserAuthenticationState(http);
        Assert.True((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
        handler.UserId = "user-2";
        await state.RefreshAsync();
        Assert.False((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
        await state.RefreshAsync();
        Assert.False((await state.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated);
    }
}