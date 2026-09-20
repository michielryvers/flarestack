using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using Aspire.Hosting.Flarestack.Configuration;

namespace Aspire.Hosting.Flarestack;

/// <summary>Configures machine-specific Aspire dashboard endpoints.</summary>
public static class FlarestackLocal
{
    /// <summary>Applies this machine's dashboard ports before creating the Aspire builder.</summary>
    /// <param name="infrastructureDirectory">The infrastructure directory, relative to the AppHost file directory or absolute.</param>
    /// <param name="appHostFile">The calling AppHost source file, supplied by the compiler by default.</param>
    public static void Configure(string infrastructureDirectory, [CallerFilePath] string appHostFile = "")
    {
        var infrastructurePath = Path.GetFullPath(infrastructureDirectory, Path.GetDirectoryName(appHostFile)!);
        var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(infrastructurePath, "package.json")))!;
        var configurationPath = Path.GetFullPath((string)manifest["flarestack"]!["configuration"]!, infrastructurePath);
        var settings = FlarestackLocalConfiguration.Read(configurationPath);
        if (settings["dashboardPort"] is null)
        {
            return;
        }

        foreach (var (key, setting) in new[]
            {
                ("ASPNETCORE_URLS", "dashboardPort"),
                ("ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL", "otlpHttpPort"),
                ("ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL", "otlpGrpcPort"),
                ("ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL", "resourcePort")
            })
        {
            Environment.SetEnvironmentVariable(key, $"http://127.0.0.1:{(int)settings[setting]!}");
        }
    }
}
