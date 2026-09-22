using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.CommandLine;

namespace Aspire.Hosting.Flarestack.Configuration;

internal static class FlarestackLocalEndpoints
{
    internal static void Apply(ConfigurationManager configuration, string configurationPath)
    {
        var settings = FlarestackLocalConfiguration.Read(configurationPath);
        if (settings["dashboardPort"] is null)
        {
            return;
        }

        var endpoints = new Dictionary<string, string?>();
        foreach (var (key, setting) in new[]
        {
            ("ASPNETCORE_URLS", "dashboardPort"),
            ("ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL", "otlpHttpPort"),
            ("ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL", "otlpGrpcPort"),
            ("ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL", "resourcePort")
        })
        {
            if (settings[setting]?.GetValue<int>() is not int port || port is < 1 or > 65535)
            {
                throw new InvalidOperationException($"Flarestack {setting} must be a port between 1 and 65535 when dashboardPort is configured.");
            }

            endpoints[key] = $"http://127.0.0.1:{port}";
        }

        // Preserve explicit CLI endpoint values. Adding one provider avoids rebuilding the existing
        // configuration providers, which could discard values already set by the caller or Aspire.
        foreach (var key in endpoints.Keys.ToArray())
        {
            foreach (var provider in ((IConfigurationRoot)configuration).Providers.OfType<CommandLineConfigurationProvider>().Reverse())
            {
                if (provider.TryGet(key, out var value))
                {
                    endpoints[key] = value;
                    break;
                }
            }
        }

        configuration.AddInMemoryCollection(endpoints);
    }
}
