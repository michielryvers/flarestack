using System.Net;
using Flarestack.Email;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Flarestack.Tests;

public sealed class EmailConfigurationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RegistrationDefaultsReachTheTypedClient(bool useOptions)
    {
        var services = new ServiceCollection();
        var configuration = Configuration();
        if (useOptions)
        {
            services.AddFlarestackEmail(configuration, _ => { });
        }
        else
        {
            services.AddFlarestackEmail(configuration);
        }

        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client =>
        {
            Assert.Equal(new Uri("http://email.internal"), client.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(30), client.Timeout);
        });
        using var provider = services.BuildServiceProvider();

        var result = await provider.GetRequiredService<IFlarestackEmailSender>()
            .SendAsync(new("user@example.com", "Hello", "body"));

        Assert.Equal(EmailDeliveryState.Accepted, result.State);
        Assert.Equal(new Uri("http://email.internal/v1/email"), handler.RequestUri);
        Assert.Equal("2", handler.Protocol);
        Assert.False(string.IsNullOrEmpty(handler.Release));
        Assert.Null(handler.BridgeToken);
    }

    [Fact]
    public async Task BoundOptionsAndCallerOverridesReachTheTypedClient()
    {
        var services = new ServiceCollection();
        var configuration = Configuration(
            ("Flarestack:Email:BaseAddress", "http://localhost:8080"),
            ("Flarestack:Email:Timeout", "00:00:12"),
            ("Flarestack:LocalBridgeToken", "local-test-token"));
        services.AddFlarestackEmail(configuration, options =>
        {
            Assert.Equal("http://localhost:8080", options.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(12), options.Timeout);
            options.BaseAddress = "http://127.0.0.1:9090";
            options.Timeout = TimeSpan.FromSeconds(7);
        });
        services.PostConfigure<EmailOptions>(options => options.Timeout = TimeSpan.FromSeconds(9));

        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client =>
        {
            Assert.Equal(new Uri("http://127.0.0.1:9090"), client.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(9), client.Timeout);
        });
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<EmailOptions>>().Value;
        Assert.Equal("http://127.0.0.1:9090", options.BaseAddress);
        Assert.Equal(TimeSpan.FromSeconds(9), options.Timeout);

        await provider.GetRequiredService<IFlarestackEmailSender>()
            .SendAsync(new("user@example.com", "Hello", "body"));

        Assert.Equal(new Uri("http://127.0.0.1:9090/v1/email"), handler.RequestUri);
        Assert.Equal("local-test-token", handler.BridgeToken);
        Assert.Equal("2", handler.Protocol);
    }

    [Fact]
    public void LegacyRegistrationKeepsItsFixedTimeout()
    {
        var services = new ServiceCollection();
        services.AddFlarestackEmail(Configuration(("Flarestack:Email:Timeout", "invalid")));
        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client => Assert.Equal(TimeSpan.FromSeconds(30), client.Timeout));
        using var provider = services.BuildServiceProvider();

        Assert.IsType<EmailSender>(provider.GetRequiredService<IFlarestackEmailSender>());
    }

    [Theory]
    [InlineData("ftp://email.internal", null)]
    [InlineData("https://email.example.com", "private-bridge-token")]
    public void LegacyRegistrationRejectsInvalidConfigurationImmediately(string address, string? token)
    {
        var services = new ServiceCollection();
        var exception = Assert.Throws<InvalidOperationException>(() => services.AddFlarestackEmail(
            Configuration(("Flarestack:Email:BaseAddress", address), ("Flarestack:LocalBridgeToken", token))));

        Assert.DoesNotContain(address, exception.ToString());
        Assert.DoesNotContain("private-bridge-token", exception.ToString());
    }

    [Theory]
    [InlineData("relative-secret-address")]
    [InlineData("ftp://private-user:private-password@email.example.com")]
    [InlineData("https://email.example.com/?secret=private-query-value")]
    public async Task OptionsRejectUnsafeAddressesAtHostStartupWithoutLeakingSecrets(string address)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackEmail(
            Configuration(("Flarestack:LocalBridgeToken", "private-bridge-token")),
            options => options.BaseAddress = address);
        using var host = builder.Build();

        var exception = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());

        Assert.DoesNotContain(address, exception.ToString());
        Assert.DoesNotContain("private-password", exception.ToString());
        Assert.DoesNotContain("private-query-value", exception.ToString());
        Assert.DoesNotContain("private-bridge-token", exception.ToString());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    [InlineData(-0.5)]
    [InlineData(2147483648)]
    public async Task InvalidTimeoutFailsAtHostStartup(double milliseconds)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackEmail(Configuration(), options =>
            options.Timeout = TimeSpan.FromMilliseconds(milliseconds));
        using var host = builder.Build();

        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(int.MaxValue)]
    public void ValidTimeoutBoundariesReachTheTypedClient(int milliseconds)
    {
        var timeout = TimeSpan.FromMilliseconds(milliseconds);
        var services = new ServiceCollection();
        services.AddFlarestackEmail(Configuration(), options => options.Timeout = timeout);
        using var handler = new RecordingHandler();
        ObserveClient(services, handler, client => Assert.Equal(timeout, client.Timeout));
        using var provider = services.BuildServiceProvider();

        Assert.IsType<EmailSender>(provider.GetRequiredService<IFlarestackEmailSender>());
    }

    [Fact]
    public async Task PostConfigureCannotSendBridgeCredentialsToANonLoopbackAddress()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddFlarestackEmail(
            Configuration(("Flarestack:LocalBridgeToken", "private-bridge-token")),
            options => options.BaseAddress = "http://localhost:8080");
        builder.Services.PostConfigure<EmailOptions>(options => options.BaseAddress = "https://email.example.com");
        using var host = builder.Build();

        var exception = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());

        Assert.DoesNotContain("private-bridge-token", exception.ToString());
    }

    private static IConfiguration Configuration(params (string Key, string? Value)[] values)
    {
        return new ConfigurationBuilder().AddInMemoryCollection(
            values.Select(value => new KeyValuePair<string, string?>(value.Key, value.Value))).Build();
    }

    private static void ObserveClient(
        IServiceCollection services,
        HttpMessageHandler handler,
        Action<HttpClient> observe)
    {
        services.ConfigureAll<HttpClientFactoryOptions>(options =>
        {
            options.HttpClientActions.Add(observe);
            options.HttpMessageHandlerBuilderActions.Add(builder => builder.PrimaryHandler = handler);
        });
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public Uri? RequestUri { get; private set; }
        public string? Protocol { get; private set; }
        public string? Release { get; private set; }
        public string? BridgeToken { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUri = request.RequestUri;
            Protocol = request.Headers.GetValues("x-flarestack-protocol").Single();
            Release = request.Headers.GetValues("x-flarestack-release").Single();
            BridgeToken = request.Headers.TryGetValues("x-flarestack-bridge", out var values) ? values.Single() : null;
            var response = new HttpResponseMessage(HttpStatusCode.Accepted);
            response.Headers.Add("x-flarestack-protocol", "2");
            return Task.FromResult(response);
        }
    }
}
