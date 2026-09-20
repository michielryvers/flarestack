using System.Net;
using System.Text.Json;
using Flarestack.D1;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Flarestack.Tests;

public class D1ContractTests
{
    [Theory]
    [InlineData("Flarestack:D1:BaseAddress", "ftp://d1.example")]
    [InlineData("Flarestack:D1:TimeoutSeconds", "0")]
    [InlineData("Flarestack:D1:MaxCommands", "0")]
    [InlineData("Flarestack:D1:MaxRequestBytes", "0")]
    public void RejectsInvalidConfigurationDuringRegistration(string key, string value)
    {
        var configuration = Configure(new()
        {
            [key] = value
        });

        Assert.Throws<InvalidOperationException>(() =>
            new ServiceCollection().AddFlarestackD1(configuration));
    }

    [Fact]
    public void RejectsLocalCredentialsForRemoteAddressDuringRegistration()
    {
        var configuration = Configure(new()
        {
            ["Flarestack:D1:BaseAddress"] = "https://remote.example",
            ["Flarestack:LocalBridgeToken"] = "test-only-bridge-token"
        });

        Assert.Throws<InvalidOperationException>(() =>
            new ServiceCollection().AddFlarestackD1(configuration));
    }

    [Fact]
    public async Task RegistrationSendsLocalCredentialsAndProtocolToConfiguredBridge()
    {
        var configuration = Configure(new()
        {
            ["Flarestack:D1:BaseAddress"] = "http://127.0.0.1:8789",
            ["Flarestack:LocalBridgeToken"] = "test-only-bridge-token"
        });
        var handler = new RecordingHandler(HttpStatusCode.OK, """
            {"ok":true,"rowsAffected":1}
            """);
        var services = new ServiceCollection();
        services.AddFlarestackD1(configuration);
        services.AddHttpClient<ID1Database, D1Database>()
            .ConfigurePrimaryHttpMessageHandler(() => handler);
        using var provider = services.BuildServiceProvider();

        var affected = await provider.GetRequiredService<ID1Database>()
            .ExecuteAsync("UPDATE todo SET is_complete = ?1 WHERE owner_id = ?2", [true, "owner"]);

        Assert.Equal(1, affected);
        Assert.Equal("http://127.0.0.1:8789/v1/commands", handler.Address);
        Assert.Equal("test-only-bridge-token", handler.BridgeToken);
        Assert.Equal("2", handler.Protocol);
        Assert.False(string.IsNullOrWhiteSpace(handler.Release));
        using var payload = JsonDocument.Parse(handler.Body);
        Assert.Equal(2, payload.RootElement.GetProperty("protocolVersion").GetInt32());
        Assert.Equal("execute", payload.RootElement.GetProperty("operation").GetString());
        Assert.Equal(1, payload.RootElement.GetProperty("parameters")[0].GetInt32());
        Assert.Equal("owner", payload.RootElement.GetProperty("parameters")[1].GetString());
    }

    [Fact]
    public async Task FailedMutationIsNotRetriedAndPreservesErrorDetails()
    {
        var handler = new RecordingHandler(HttpStatusCode.BadGateway, """
            {"ok":false,"error":{"code":"D1_FAILURE"},"correlationId":"test-correlation"}
            """);
        using var client = new HttpClient(handler) { BaseAddress = new Uri("http://d1.internal") };
        var database = new D1Database(client, new D1Options(), NullLogger<D1Database>.Instance);

        var error = await Assert.ThrowsAsync<D1Exception>(() =>
            database.ExecuteAsync("DELETE FROM todo WHERE owner_id = ?1", ["owner"]));

        Assert.Equal(1, handler.RequestCount);
        Assert.Equal("D1_FAILURE", error.Code);
        Assert.Equal("execute", error.Operation);
        Assert.Equal("test-correlation", error.CorrelationId);
    }

    private static IConfiguration Configure(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private sealed class RecordingHandler(HttpStatusCode status, string responseBody) : HttpMessageHandler
    {
        public int RequestCount
        {
            get; private set;
        }
        public string? Address
        {
            get; private set;
        }
        public string? BridgeToken
        {
            get; private set;
        }
        public string? Protocol
        {
            get; private set;
        }
        public string? Release
        {
            get; private set;
        }
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            Address = request.RequestUri?.AbsoluteUri;
            BridgeToken = ReadHeader(request, "x-flarestack-bridge");
            Protocol = ReadHeader(request, "x-flarestack-protocol");
            Release = ReadHeader(request, "x-flarestack-release");
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            var response = new HttpResponseMessage(status) { Content = new StringContent(responseBody) };
            response.Headers.Add("x-flarestack-protocol", "2");
            return response;
        }

        private static string? ReadHeader(HttpRequestMessage request, string name) =>
            request.Headers.TryGetValues(name, out var values) ? values.Single() : null;
    }
}
