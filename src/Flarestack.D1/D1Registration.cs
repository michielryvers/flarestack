using Flarestack.Internal;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Flarestack.D1;

/// <summary>Registers the Flarestack D1 client.</summary>
public static class D1Registration
{
    /// <summary>
    /// Registers a typed HTTP client using Flarestack:D1 configuration.
    /// Local bridge credentials require a loopback address.
    /// Configuration is validated when this method is called.
    /// </summary>
    public static IServiceCollection AddFlarestackD1(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var options = configuration.GetSection("Flarestack:D1").Get<D1Options>() ?? new();

        if (!Uri.TryCreate(options.BaseAddress, UriKind.Absolute, out var address) ||
            address.Scheme is not ("http" or "https") ||
            options.TimeoutSeconds <= 0 || options.MaxCommands <= 0 || options.MaxRequestBytes <= 0)
        {
            throw new InvalidOperationException("Invalid Flarestack:D1 configuration.");
        }

        var bridgeToken = configuration["Flarestack:LocalBridgeToken"];

        if (!string.IsNullOrEmpty(bridgeToken) && !address.IsLoopback)
        {
            throw new InvalidOperationException("Local bridge credentials require a loopback D1 address.");
        }

        services.AddSingleton(options);
        services.AddHttpClient<ID1Database, D1Database>(client =>
        {
            Protocol.Configure(client);
            client.BaseAddress = address;
            client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);

            if (!string.IsNullOrEmpty(bridgeToken))
            {
                client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken);
            }
        });

        return services;
    }

    /// <summary>
    /// Registers the D1 client by binding <see cref="D1Options.SectionName"/>,
    /// then applying caller overrides. Options are validated at host startup or first access.
    /// Local bridge credentials are read from Flarestack:LocalBridgeToken at registration.
    /// </summary>
    public static IServiceCollection AddFlarestackD1(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<D1Options> configure)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(configure);

        var bridgeToken = configuration["Flarestack:LocalBridgeToken"];

        services.AddOptions<D1Options>()
            .Bind(configuration.GetSection(D1Options.SectionName))
            .Configure(configure)
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<D1Options>>(
            new D1OptionsValidator(!string.IsNullOrEmpty(bridgeToken)));
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<D1Options>>().Value);

        services.AddHttpClient<ID1Database, D1Database>((provider, client) =>
        {
            var options = provider.GetRequiredService<IOptions<D1Options>>().Value;
            Protocol.Configure(client);
            client.BaseAddress = new Uri(options.BaseAddress);
            client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);

            if (!string.IsNullOrEmpty(bridgeToken))
            {
                client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken);
            }
        });

        return services;
    }
}
