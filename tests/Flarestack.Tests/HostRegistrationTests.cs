using Flarestack.Authentication;
using Flarestack.D1;
using Flarestack.Email;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;
using AuthenticationOptions = Flarestack.Authentication.Configuration.AuthenticationOptions;

namespace Flarestack.Tests;

public sealed class HostRegistrationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Canonical_registration_binds_configuration_before_optional_overrides(bool customize)
    {
        var builder = CreateBuilder();
        builder.Configuration["Flarestack:D1:MaxCommands"] = "25";
        builder.Configuration["Flarestack:Email:Timeout"] = "00:00:12";
        Assert.Same(builder, builder.AddFlarestackD1(customize ? options => options.MaxCommands = 10 : null));
        Assert.Same(builder, builder.AddFlarestackEmail(customize ? options => options.Timeout = TimeSpan.FromSeconds(7) : null));
        Assert.Same(builder, builder.AddFlarestackAuthentication(customize ? options => options.ClientId = "custom-client" : null));
        using var host = builder.Build();

        await host.StartAsync();

        Assert.Equal(customize ? 10 : 25, host.Services.GetRequiredService<IOptions<D1Options>>().Value.MaxCommands);
        Assert.Equal(TimeSpan.FromSeconds(customize ? 7 : 12), host.Services.GetRequiredService<IOptions<EmailOptions>>().Value.Timeout);
        Assert.Equal(customize ? "custom-client" : "test-client", host.Services.GetRequiredService<IOptions<AuthenticationOptions>>().Value.ClientId);
        await host.StopAsync();
    }

    [Theory]
    [InlineData("D1")]
    [InlineData("Email")]
    [InlineData("Authentication")]
    public async Task Callback_free_registration_validates_late_configuration_at_startup(string package)
    {
        var builder = CreateBuilder();
        switch (package)
        {
            case "D1":
                builder.AddFlarestackD1();
                builder.Services.PostConfigure<D1Options>(options => options.MaxCommands = 0);
                break;
            case "Email":
                builder.AddFlarestackEmail();
                builder.Services.PostConfigure<EmailOptions>(options => options.Timeout = TimeSpan.Zero);
                break;
            case "Authentication":
                builder.AddFlarestackAuthentication();
                builder.Services.PostConfigure<AuthenticationOptions>(options => options.Authority = "http://example.test/auth");
                break;
        }

        using var host = builder.Build();
        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    private static HostApplicationBuilder CreateBuilder()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddRouting();
        builder.Configuration["Flarestack:Authentication:Authority"] = "https://example.test/auth";
        builder.Configuration["Flarestack:Authentication:ClientId"] = "test-client";
        return builder;
    }
}
