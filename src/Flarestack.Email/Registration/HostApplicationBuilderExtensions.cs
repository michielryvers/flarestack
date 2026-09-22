using Microsoft.Extensions.Hosting;

namespace Flarestack.Email;

/// <summary>Registers the email client using application configuration and startup validation.</summary>
public static class EmailHostApplicationBuilderExtensions
{
    /// <summary>Binds email settings, applies optional overrides, and validates the final options at startup.</summary>
    public static TBuilder AddFlarestackEmail<TBuilder>(this TBuilder builder, Action<EmailOptions>? configure = null)
        where TBuilder : IHostApplicationBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Services.AddFlarestackEmail(builder.Configuration, configure ?? (static _ => { }));
        return builder;
    }
}
