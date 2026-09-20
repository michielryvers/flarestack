using System.Security.Cryptography;
using System.Text;
using Flarestack.Authentication.Configuration;
using Flarestack.Authentication.Registration;
using Flarestack.Authentication.Transport;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Flarestack.Tests;

public sealed class AuthenticationConfigurationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DefaultRegistrationPreservesCookieOidcAndAccountClientSettings(bool useOptions)
    {
        var builder = Builder();
        if (useOptions)
        {
            builder.Services.AddFlarestackAuthentication(Configuration(), _ => { });
        }
        else
        {
            builder.Services.AddFlarestackAuthentication(Configuration());
        }

        ObserveClient(builder.Services, "http://auth.internal", null);
        using var host = builder.Build();
        AssertSettings(host.Services, "https://identity.example.com", "test-client", false);
        Assert.IsType<AccountClient>(host.Services.GetRequiredService<AccountClient>());
    }

    [Fact]
    public async Task BindingConfigureAndPostConfigureReachAllConsumers()
    {
        var builder = Builder(Environments.Development);
        builder.Services.AddFlarestackAuthentication(Configuration(
            ("Flarestack:Authentication:BackchannelBaseAddress", "http://localhost:8080"),
            ("Flarestack:LocalBridgeToken", "local-test-token")), options =>
        {
            Assert.Equal("test-client", options.ClientId);
            Assert.Equal("http://localhost:8080", options.BackchannelBaseAddress);
            options.Authority = "http://localhost:7000";
            options.ClientId = "caller-client";
        });
        builder.Services.Configure<AuthenticationOptions>(options => options.ClientId = "late-client");
        builder.Services.PostConfigure<AuthenticationOptions>(options =>
        {
            options.ClientId = "final-client";
            options.BackchannelBaseAddress = "http://127.0.0.1:9090";
        });
        ObserveClient(builder.Services, "http://127.0.0.1:9090", "local-test-token");
        using var host = builder.Build();
        await host.StartAsync();

        var settings = host.Services.GetRequiredService<IOptions<AuthenticationOptions>>().Value;
        Assert.Equal("final-client", settings.ClientId);
        Assert.Equal("http://127.0.0.1:9090", settings.BackchannelBaseAddress);
        AssertSettings(host.Services, "http://localhost:7000", "final-client", true);
        Assert.IsType<AuthorityBackchannelHandler>(Oidc(host.Services).BackchannelHttpHandler);
        Assert.IsType<AccountClient>(host.Services.GetRequiredService<AccountClient>());
        await host.StopAsync();
    }

    [Theory]
    [InlineData("Flarestack:Authentication:Authority", "relative-private-value", null)]
    [InlineData("Flarestack:Authentication:Authority", "http://identity.example.com", null)]
    [InlineData("Flarestack:Authentication:ClientId", " ", null)]
    [InlineData("Flarestack:Authentication:BackchannelBaseAddress", "", null)]
    [InlineData("Flarestack:Authentication:BackchannelBaseAddress", "ftp://private-user:private-password@identity.example.com", null)]
    [InlineData("Flarestack:Authentication:BackchannelBaseAddress", "https://identity.example.com/?secret=private-query-value", "private-bridge-token")]
    [InlineData("Flarestack:Authentication:BackchannelBaseAddress", null, "private-bridge-token")]
    public async Task InvalidFinalOptionsFailAtStartupWithoutLeakingValues(string key, string? value, string? token)
    {
        var builder = Builder();
        builder.Services.AddFlarestackAuthentication(Configuration(
            (key, value), ("Flarestack:LocalBridgeToken", token)), _ => { });
        using var host = builder.Build();

        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());

        Assert.DoesNotContain("private-value", error.ToString());
        Assert.DoesNotContain("private-password", error.ToString());
        Assert.DoesNotContain("private-query-value", error.ToString());
        Assert.DoesNotContain("private-bridge-token", error.ToString());
    }

    [Theory]
    [InlineData("Production", "http://localhost:7000")]
    [InlineData("Staging", "http://localhost:7000")]
    [InlineData("Production", "https://localhost:7000")]
    public async Task LateLoopbackAuthorityFailsAtStartupOutsideDevelopment(string environment, string authority)
    {
        var builder = Builder(environment);
        builder.Services.AddFlarestackAuthentication(Configuration(), _ => { });
        builder.Services.PostConfigure<AuthenticationOptions>(options => options.Authority = authority);
        using var host = builder.Build();

        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    [Fact]
    public async Task PostConfigureCannotSendBridgeTokenToRemoteAddress()
    {
        var builder = Builder();
        builder.Services.AddFlarestackAuthentication(Configuration(
            ("Flarestack:LocalBridgeToken", "private-bridge-token")), options =>
            options.BackchannelBaseAddress = "http://localhost:8080");
        builder.Services.PostConfigure<AuthenticationOptions>(options =>
            options.BackchannelBaseAddress = "https://remote.example.com");
        using var host = builder.Build();

        var error = await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
        Assert.DoesNotContain("private-bridge-token", error.ToString());
    }

    [Theory]
    [InlineData("Flarestack:Authentication:Authority", null)]
    [InlineData("Flarestack:Authentication:ClientId", null)]
    [InlineData("Flarestack:Authentication:Authority", "http://identity.example.com")]
    public void LegacyRegistrationStillValidatesImmediately(string key, string? value)
    {
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection()
            .AddFlarestackAuthentication(Configuration((key, value))));
    }

    [Fact]
    public void LegacyOidcEnvironmentGuardRemains()
    {
        var builder = Builder();
        builder.Services.AddFlarestackAuthentication(Configuration(
            ("Flarestack:Authentication:Authority", "http://localhost:7000")));
        using var host = builder.Build();

        Assert.Throws<InvalidOperationException>(() => Oidc(host.Services));
    }

    [Fact]
    public void OptionsPathRetainsGuardForLateOidcOverrides()
    {
        var builder = Builder();
        builder.Services.AddFlarestackAuthentication(Configuration(), _ => { });
        builder.Services.Configure<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme,
            options => options.RequireHttpsMetadata = false);
        using var host = builder.Build();

        Assert.Throws<InvalidOperationException>(() => Oidc(host.Services));
    }

    private static void AssertSettings(IServiceProvider services, string authority, string clientId, bool loopback)
    {
        var cookie = services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        Assert.Equal("Flarestack.Session." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(clientId)))[..16], cookie.Cookie.Name);
        Assert.True(cookie.Cookie.HttpOnly);
        Assert.Equal(SameSiteMode.Lax, cookie.Cookie.SameSite);
        Assert.Equal(loopback ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always, cookie.Cookie.SecurePolicy);
        Assert.Equal(TimeSpan.FromHours(8), cookie.ExpireTimeSpan);
        Assert.True(cookie.SlidingExpiration);
        Assert.NotNull(cookie.Events.OnValidatePrincipal);
        var oidc = Oidc(services);
        Assert.Equal(authority, oidc.Authority);
        Assert.Equal(clientId, oidc.ClientId);
        Assert.Equal("code", oidc.ResponseType);
        Assert.True(oidc.UsePkce);
        Assert.False(oidc.SaveTokens);
        Assert.False(oidc.MapInboundClaims);
        Assert.Equal(!loopback, oidc.RequireHttpsMetadata);
        Assert.Equal(new[] { "openid", "profile", "email" }, oidc.Scope);
        if (loopback)
        {
            Assert.Equal("query", oidc.ResponseMode);
            Assert.Equal(SameSiteMode.Lax, oidc.CorrelationCookie.SameSite);
            Assert.Equal(CookieSecurePolicy.SameAsRequest, oidc.NonceCookie.SecurePolicy);
        }
        else
        {
            Assert.IsNotType<AuthorityBackchannelHandler>(oidc.BackchannelHttpHandler);
        }
    }

    private static OpenIdConnectOptions Oidc(IServiceProvider services) =>
        services.GetRequiredService<IOptionsMonitor<OpenIdConnectOptions>>().Get(OpenIdConnectDefaults.AuthenticationScheme);

    private static void ObserveClient(IServiceCollection services, string address, string? token)
    {
        services.ConfigureAll<HttpClientFactoryOptions>(options => options.HttpClientActions.Add(client =>
        {
            Assert.Equal(new Uri(address), client.BaseAddress);
            Assert.Equal(TimeSpan.FromSeconds(10), client.Timeout);
            Assert.Equal("2", client.DefaultRequestHeaders.GetValues("x-flarestack-protocol").Single());
            Assert.False(string.IsNullOrEmpty(client.DefaultRequestHeaders.GetValues("x-flarestack-release").Single()));
            Assert.Equal(token, client.DefaultRequestHeaders.TryGetValues("x-flarestack-bridge", out var values) ? values.Single() : null);
        }));
    }

    private static HostApplicationBuilder Builder(string environment = "Production")
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { EnvironmentName = environment });
        builder.Logging.ClearProviders();
        builder.Services.AddRouting();
        return builder;
    }

    private static IConfiguration Configuration(params (string Key, string? Value)[] values)
    {
        var entries = new Dictionary<string, string?>
        {
            ["Flarestack:Authentication:Authority"] = "https://identity.example.com",
            ["Flarestack:Authentication:ClientId"] = "test-client"
        };
        foreach (var (key, value) in values)
        {
            entries[key] = value;
        }
        return new ConfigurationBuilder().AddInMemoryCollection(entries).Build();
    }
}
