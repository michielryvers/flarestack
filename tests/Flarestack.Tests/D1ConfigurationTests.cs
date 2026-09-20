using System.Diagnostics;
using System.Net;
using Flarestack.D1;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Flarestack.Tests;

public sealed class D1ConfigurationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DefaultsReachTheTypedClient(bool useOptions)
    {
        var services = new ServiceCollection();
        if (useOptions)
        {
            services.AddFlarestackD1(Configuration(), _ => { });
        }
        else
        {
            services.AddFlarestackD1(Configuration());
        }

        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client =>
        {
            Assert.Equal(new Uri("http://d1.internal"), client.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(30), client.Timeout);
        });
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<D1Options>();
        Assert.Equal(100, options.MaxCommands);
        Assert.Equal(1_048_576, options.MaxRequestBytes);
        Assert.False(options.IncludeSqlInTraces);

        Assert.Equal(1, await provider.GetRequiredService<ID1Database>().ExecuteAsync("SELECT 1"));
        Assert.Equal(new Uri("http://d1.internal/v1/commands"), handler.RequestUri);
        Assert.Equal("2", handler.Protocol);
        Assert.False(string.IsNullOrEmpty(handler.Release));
        Assert.Null(handler.BridgeToken);
    }

    [Fact]
    public async Task BoundCallerAndLateOverridesReachClientLimitsAndTracing()
    {
        var services = new ServiceCollection();
        var configuration = Configuration(
            ("Flarestack:D1:BaseAddress", "http://localhost:8080"),
            ("Flarestack:D1:TimeoutSeconds", "12"),
            ("Flarestack:D1:MaxCommands", "3"),
            ("Flarestack:D1:MaxRequestBytes", "2048"),
            ("Flarestack:LocalBridgeToken", "local-test-token"));
        services.AddFlarestackD1(configuration, options =>
        {
            Assert.Equal("http://localhost:8080", options.BaseAddress);
            Assert.Equal(12, options.TimeoutSeconds);
            Assert.Equal(3, options.MaxCommands);
            Assert.Equal(2048, options.MaxRequestBytes);
            options.BaseAddress = "http://127.0.0.1:9090";
            options.TimeoutSeconds = 7;
            options.MaxCommands = 2;
            options.MaxRequestBytes = 1024;
        });
        services.PostConfigure<D1Options>(options =>
        {
            options.TimeoutSeconds = 9;
            options.MaxCommands = 1;
            options.MaxRequestBytes = 256;
            options.IncludeSqlInTraces = true;
        });
        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client =>
        {
            Assert.Equal(new Uri("http://127.0.0.1:9090"), client.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(9), client.Timeout);
        });
        using var provider = services.BuildServiceProvider();
        Assert.Same(provider.GetRequiredService<IOptions<D1Options>>().Value,
            provider.GetRequiredService<D1Options>());
        var database = provider.GetRequiredService<ID1Database>();
        await Assert.ThrowsAsync<ArgumentException>(() => database.BatchAsync(
            [new("SELECT 1", []), new("SELECT 2", [])]));
        await Assert.ThrowsAsync<ArgumentException>(() => database.ExecuteAsync("SELECT ?", [new string('x', 256)]));
        Assert.Equal(0, handler.RequestCount);

        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == D1Database.ActivitySource.Name,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData
        };
        ActivitySource.AddActivityListener(listener);
        Assert.Equal(1, await database.ExecuteAsync("SELECT ?", ["private-parameter"]));
        Assert.Equal("SELECT ?", handler.SqlTrace);
        Assert.Equal(new Uri("http://127.0.0.1:9090/v1/commands"), handler.RequestUri);
        Assert.Equal("local-test-token", handler.BridgeToken);
        Assert.Equal("2", handler.Protocol);
    }

    [Theory]
    [InlineData("TimeoutSeconds", "0")]
    [InlineData("TimeoutSeconds", "-1")]
    [InlineData("TimeoutSeconds", "2147484")]
    [InlineData("MaxCommands", "0")]
    [InlineData("MaxRequestBytes", "-1")]
    public async Task InvalidBoundValuesFailAtStartup(string property, string value)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackD1(Configuration(($"Flarestack:D1:{property}", value)), _ => { });
        using var host = builder.Build();

        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    [Theory]
    [InlineData("relative-secret-address")]
    [InlineData("ftp://private-user:private-password@d1.example.com")]
    [InlineData("https://d1.example.com/?secret=private-query-value")]
    public async Task InvalidAddressesFailSafelyAfterPostConfigure(string address)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackD1(
            Configuration(("Flarestack:LocalBridgeToken", "private-bridge-token")),
            options => options.BaseAddress = "http://localhost:8080");
        builder.Services.PostConfigure<D1Options>(options => options.BaseAddress = address);
        using var host = builder.Build();

        var exception = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
        Assert.DoesNotContain(address, exception.ToString());
        Assert.DoesNotContain("private-password", exception.ToString());
        Assert.DoesNotContain("private-query-value", exception.ToString());
        Assert.DoesNotContain("private-bridge-token", exception.ToString());
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2147483)]
    public void ValidTimeoutBoundariesReachTheTypedClient(int seconds)
    {
        var services = new ServiceCollection();
        services.AddFlarestackD1(Configuration(), options => options.TimeoutSeconds = seconds);
        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client => Assert.Equal(TimeSpan.FromSeconds(seconds), client.Timeout));
        using var provider = services.BuildServiceProvider();

        Assert.IsType<D1Database>(provider.GetRequiredService<ID1Database>());
    }

    [Fact]
    public void LegacyOversizedTimeoutStillFailsOnlyWhenClientIsCreated()
    {
        var services = new ServiceCollection();
        services.AddFlarestackD1(Configuration(("Flarestack:D1:TimeoutSeconds", "2147484")));
        using var provider = services.BuildServiceProvider();

        Assert.Throws<ArgumentOutOfRangeException>(() => provider.GetRequiredService<ID1Database>());
    }

    [Fact]
    public async Task LateInvalidLimitFailsAtStartup()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackD1(Configuration(), _ => { });
        builder.Services.PostConfigure<D1Options>(options => options.MaxCommands = 0);
        using var host = builder.Build();

        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    private static IConfiguration Configuration(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(
            values.Select(value => new KeyValuePair<string, string?>(value.Key, value.Value))).Build();

    private static void ObserveClient(IServiceCollection services, HttpMessageHandler handler, Action<HttpClient> observe)
    {
        services.ConfigureAll<HttpClientFactoryOptions>(options =>
        {
            options.HttpClientActions.Add(observe);
            options.HttpMessageHandlerBuilderActions.Add(builder => builder.PrimaryHandler = handler);
        });
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        public Uri? RequestUri { get; private set; }
        public string? Protocol { get; private set; }
        public string? Release { get; private set; }
        public string? BridgeToken { get; private set; }
        public object? SqlTrace { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            RequestUri = request.RequestUri;
            Protocol = request.Headers.GetValues("x-flarestack-protocol").Single();
            Release = request.Headers.GetValues("x-flarestack-release").Single();
            BridgeToken = request.Headers.TryGetValues("x-flarestack-bridge", out var values) ? values.Single() : null;
            SqlTrace = Activity.Current?.GetTagItem("db.query.text");
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"ok":true,"rowsAffected":1}""")
            };
            response.Headers.Add("x-flarestack-protocol", "2");
            return Task.FromResult(response);
        }
    }
}
