using System.Net;
using System.Security.Claims;
using Flarestack.Authentication.Transport;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Flarestack.Tests;

public class SessionRetryTests
{
    private sealed class Handler(params int[] statuses) : HttpMessageHandler
    {
        public int Requests;
        public string Protocol = "2";
        public bool IncludeErrorProtocol;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var status = statuses[Math.Min(Requests++, statuses.Length - 1)];
            var response = new HttpResponseMessage((HttpStatusCode)status)
            {
                Content = new StringContent("{\"id\":\"user-1\",\"email\":\"a@example.test\",\"name\":\"Name\",\"roles\":[\"user\"]}")
            };
            // Infrastructure failures can occur before the private protocol handler responds.
            if (status < 500 || IncludeErrorProtocol) response.Headers.Add("x-flarestack-protocol", Protocol);
            return Task.FromResult(response);
        }
    }
    private static ClaimsPrincipal Actor => new(new ClaimsIdentity([new("sub", "user-1"), new("sid", "session-1")], "Cookies"));

    [Theory]
    [InlineData(500, 200, 2, true)]
    [InlineData(503, 503, 3, false)]
    [InlineData(401, 200, 1, false)]
    [InlineData(403, 200, 1, false)]
    public async Task OnlySuccessfulLiveResponseCanAuthorizeAfterBoundedReadRetries(int first, int next, int count, bool valid)
    {
        var handler = new Handler(first, next);
        using var http = new HttpClient(handler) { BaseAddress = new("http://auth.internal") };
        var client = new AccountClient(http, NullLogger<AccountClient>.Instance);
        Assert.Equal(valid, await client.ValidateAsync(Actor) is not null);
        Assert.Equal(count, handler.Requests);
    }

    [Theory]
    [InlineData(200)]
    [InlineData(500)]
    public async Task ExplicitProtocolMismatchNeverRetries(int status)
    {
        var handler = new Handler(status) { Protocol = "1", IncludeErrorProtocol = true };
        using var http = new HttpClient(handler) { BaseAddress = new("http://auth.internal") };
        Assert.Null(await new AccountClient(http, NullLogger<AccountClient>.Instance).ValidateAsync(Actor));
        Assert.Equal(1, handler.Requests);
    }
}
