using Flarestack.Authentication.Configuration;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Hosting;

namespace Flarestack.Authentication;

/// <summary>Provides the normal application setup for Flarestack authentication.</summary>
public static class FlarestackAuthenticationExtensions
{
    /// <summary>Binds authentication settings, applies optional overrides, and validates at startup.</summary>
    public static TBuilder AddFlarestackAuthentication<TBuilder>(
        this TBuilder builder, Action<AuthenticationOptions>? configure = null)
        where TBuilder : IHostApplicationBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        Registration.FlarestackAuthentication.AddFlarestackAuthentication(
            builder.Services, builder.Configuration, configure ?? (static _ => { }));
        return builder;
    }

    /// <summary>Maps login, antiforgery-protected logout, and access-denied endpoints.</summary>
    public static IEndpointRouteBuilder MapFlarestackAccountEndpoints(
        this IEndpointRouteBuilder endpoints, Action<AccountEndpointOptions>? configure = null)
    {
        return Endpoints.FlarestackAuthentication.MapFlarestackAccountEndpoints(endpoints, configure);
    }
}
