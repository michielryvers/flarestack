using Flarestack.Internal;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Flarestack.Email;

/// <summary>Registers the Flarestack email client.</summary>
public static class EmailRegistration
{
    /// <summary>
    /// Registers a typed HTTP client using Flarestack:Email:BaseAddress, defaulting
    /// to the private email binding. Local bridge credentials require a loopback address.
    /// Configuration is validated when this method is called.
    /// </summary>
    public static IServiceCollection AddFlarestackEmail(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var address = new Uri(configuration["Flarestack:Email:BaseAddress"] ?? "http://email.internal");
        var bridgeToken = configuration["Flarestack:LocalBridgeToken"];

        if (address.Scheme is not ("http" or "https") ||
            (!string.IsNullOrEmpty(bridgeToken) && !address.IsLoopback))
        {
            throw new InvalidOperationException("Invalid email bridge configuration.");
        }

        services.AddHttpClient<IFlarestackEmailSender, EmailSender>(client =>
            ConfigureClient(client, address, TimeSpan.FromSeconds(30), bridgeToken));

        return services;
    }

    /// <summary>
    /// Registers the email client by binding <see cref="EmailOptions.SectionName"/>,
    /// then applying caller overrides. Options are validated at host startup or first access.
    /// Local bridge credentials are read from Flarestack:LocalBridgeToken at registration.
    /// </summary>
    public static IServiceCollection AddFlarestackEmail(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<EmailOptions> configure)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(configure);

        var bridgeToken = configuration["Flarestack:LocalBridgeToken"];

        services.AddOptions<EmailOptions>()
            .Bind(configuration.GetSection(EmailOptions.SectionName))
            .Configure(configure)
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<EmailOptions>>(
            new EmailOptionsValidator(!string.IsNullOrEmpty(bridgeToken)));

        services.AddHttpClient<IFlarestackEmailSender, EmailSender>((provider, client) =>
        {
            var options = provider.GetRequiredService<IOptions<EmailOptions>>().Value;
            ConfigureClient(client, new Uri(options.BaseAddress), options.Timeout, bridgeToken);
        });

        return services;
    }

    private static void ConfigureClient(HttpClient client, Uri address, TimeSpan timeout, string? bridgeToken)
    {
        Protocol.Configure(client);
        client.BaseAddress = address;
        client.Timeout = timeout;

        if (!string.IsNullOrEmpty(bridgeToken))
        {
            client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken);
        }
    }
}
