using Microsoft.Extensions.Hosting;

namespace Flarestack.D1;

/// <summary>Registers the D1 client using application configuration and startup validation.</summary>
public static class D1HostApplicationBuilderExtensions
{
    /// <summary>Binds D1 settings, applies optional overrides, and validates the final options at startup.</summary>
    public static TBuilder AddFlarestackD1<TBuilder>(this TBuilder builder, Action<D1Options>? configure = null)
        where TBuilder : IHostApplicationBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Services.AddFlarestackD1(builder.Configuration, configure ?? (static _ => { }));
        return builder;
    }
}
