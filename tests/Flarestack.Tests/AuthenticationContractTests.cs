using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Flarestack.Authentication.Administration;
using Flarestack.Authentication.Registration;
using Flarestack.Authentication.Transport;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Flarestack.Tests;

public class AuthenticationContractTests
{
    [Theory]
    [InlineData("https://todo.test/auth/token?code=test", true)]
    [InlineData("https://other.test/auth/token?code=test", false)]
    [InlineData("http://todo.test/auth/token?code=test", false)]
    [InlineData("https://todo.test:8443/auth/token?code=test", false)]
    [InlineData("https://todo.test.evil/auth/token?code=test", false)]
    public async Task BackchannelSendsPrivateHeadersOnlyWhenRewritingTheExactAuthority(string address, bool rewritten)
    {
        using var transport = new CallbackHandler((_, _) => Task.FromResult(Response(HttpStatusCode.OK, "{}", rewritten)));
        using var backchannel = CreateBackchannel(transport, "http://127.0.0.1:8789");
        using var client = new HttpClient(backchannel);
        using var request = new HttpRequestMessage(HttpMethod.Get, address);

        using var response = await client.SendAsync(request);

        Assert.Equal(1, transport.RequestCount);
        Assert.Equal(rewritten ? "http://127.0.0.1:8789/auth/token?code=test" : address, request.RequestUri!.AbsoluteUri);
        Assert.Equal(rewritten ? "test-only-bridge-token" : null, Header(request, "x-flarestack-bridge"));
        Assert.Equal(rewritten ? "2" : null, Header(request, "x-flarestack-protocol"));
        if (rewritten)
        {
            Assert.False(string.IsNullOrWhiteSpace(Header(request, "x-flarestack-release")));
        }
        else
        {
            Assert.Null(Header(request, "x-flarestack-release"));
        }
    }

    [Fact]
    public async Task BackchannelRejectsRemoteBridgeCredentialsBeforeSending()
    {
        using var transport = new CallbackHandler((_, _) => Task.FromResult(Response(HttpStatusCode.OK, "{}")));
        using var backchannel = CreateBackchannel(transport, "https://remote.test");
        using var client = new HttpClient(backchannel);

        await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetAsync("https://todo.test/auth/token"));

        Assert.Equal(0, transport.RequestCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SessionTransportCancellationFailsClosedUnlessTheCallerCanceled(bool callerCanceled)
    {
        using var cancellation = new CancellationTokenSource();
        using var transport = new CallbackHandler((_, token) =>
        {
            if (callerCanceled)
            {
                cancellation.Cancel();
                token.ThrowIfCancellationRequested();
            }

            throw new TaskCanceledException("Session transport timed out.");
        });
        using var client = new HttpClient(transport) { BaseAddress = new Uri("http://auth.internal") };
        var accounts = new AccountClient(client, NullLogger<AccountClient>.Instance);

        if (callerCanceled)
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => accounts.ValidateAsync(Actor(), cancellation.Token));
        }
        else
        {
            Assert.Null(await accounts.ValidateAsync(Actor(), cancellation.Token));
        }

        Assert.Equal(1, transport.RequestCount);
    }

    [Theory]
    [InlineData("role", false)]
    [InlineData("ban", false)]
    [InlineData("unban", false)]
    [InlineData("revoke", false)]
    [InlineData("role", true)]
    [InlineData("ban", true)]
    [InlineData("unban", true)]
    [InlineData("revoke", true)]
    public async Task AdministrationDoesNotRetryFailedMutations(string operation, bool networkFailure)
    {
        var paths = new List<string>();
        string? mutationBody = null;
        using var transport = new CallbackHandler(async (request, token) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            paths.Add(path);
            if (path == "/_flarestack/internal/session")
            {
                return Response(HttpStatusCode.OK, """
                    {"id":"user-1","email":"admin@example.test","name":"Admin","roles":["admin"]}
                    """);
            }

            mutationBody = await request.Content!.ReadAsStringAsync(token);
            if (networkFailure)
            {
                throw new HttpRequestException("Connection lost after sending mutation.");
            }

            return Response(HttpStatusCode.ServiceUnavailable, "{}");
        });
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Flarestack:Authentication:Authority"] = "https://todo.test/auth",
            ["Flarestack:Authentication:ClientId"] = "test"
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddFlarestackAuthentication(configuration);
        services.AddHttpClient<AccountClient>().ConfigurePrimaryHttpMessageHandler(() => transport);
        services.AddScoped<AuthenticationStateProvider, ActorStateProvider>();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var administration = scope.ServiceProvider.GetRequiredService<IUserAdministration>();

        await Assert.ThrowsAsync<HttpRequestException>(() => operation switch
        {
            "role" => administration.SetRoleAsync("target-user", UserRole.Admin),
            "ban" => administration.SetDisabledAsync("target-user", true),
            "unban" => administration.SetDisabledAsync("target-user", false),
            "revoke" => administration.RevokeSessionsAsync("target-user"),
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        });

        Assert.Equal(["/_flarestack/internal/session", $"/_flarestack/internal/{operation}"], paths);
        using var payload = JsonDocument.Parse(Assert.IsType<string>(mutationBody));
        Assert.Equal("user-1", payload.RootElement.GetProperty("userId").GetString());
        Assert.Equal("session-1", payload.RootElement.GetProperty("sessionId").GetString());
        Assert.Equal("target-user", payload.RootElement.GetProperty("targetUserId").GetString());
        Assert.Equal(operation == "role" ? "admin" : null, payload.RootElement.GetProperty("role").GetString());
    }

    private static AuthorityBackchannelHandler CreateBackchannel(HttpMessageHandler transport, string address)
    {
        var handler = new AuthorityBackchannelHandler(new Uri("https://todo.test/auth"), new Uri(address), "test-only-bridge-token");
        handler.InnerHandler!.Dispose();
        handler.InnerHandler = transport;
        return handler;
    }

    private static string? Header(HttpRequestMessage request, string name) =>
        request.Headers.TryGetValues(name, out var values) ? values.Single() : null;

    private static HttpResponseMessage Response(HttpStatusCode status, string body, bool includeProtocol = true)
    {
        var response = new HttpResponseMessage(status) { Content = new StringContent(body) };
        if (includeProtocol)
        {
            response.Headers.Add("x-flarestack-protocol", "2");
        }

        return response;
    }

    private static ClaimsPrincipal Actor() => new(new ClaimsIdentity(
        [new Claim("sub", "user-1"), new Claim("sid", "session-1"), new Claim("role", "admin")],
        "Cookies", "name", "role"));

    private sealed class ActorStateProvider : AuthenticationStateProvider
    {
        public override Task<AuthenticationState> GetAuthenticationStateAsync() =>
            Task.FromResult(new AuthenticationState(Actor()));
    }

    private sealed class CallbackHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return send(request, cancellationToken);
        }
    }
}
