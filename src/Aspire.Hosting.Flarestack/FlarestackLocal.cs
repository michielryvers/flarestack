using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
namespace Flarestack.Hosting;

public static class FlarestackLocal
{
    /// <summary>Apply this machine's dashboard ports before creating the Aspire builder.</summary>
    public static void Configure(string infrastructureDirectory, [CallerFilePath] string appHostFile = "")
    {
        var infra = Path.GetFullPath(infrastructureDirectory, Path.GetDirectoryName(appHostFile)!);
        var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(infra, "package.json")))!;
        var configuration = Path.GetFullPath((string)manifest["flarestack"]!["configuration"]!, infra);
        var settings = ReadConfiguration(configuration);
        if (settings["dashboardPort"] is null) return;
        foreach (var (key, setting) in new[] {
            ("ASPNETCORE_URLS", "dashboardPort"),
            ("ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL", "otlpHttpPort"),
            ("ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL", "otlpGrpcPort"),
            ("ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL", "resourcePort") })
            Environment.SetEnvironmentVariable(key, $"http://127.0.0.1:{(int)settings[setting]!}");
    }
    internal static JsonObject ReadConfiguration(string path)
    {
        var settings = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        var machine = Path.Combine(Path.GetDirectoryName(path)!, "local.machine.json");
        if (File.Exists(machine)) foreach (var pair in JsonNode.Parse(File.ReadAllText(machine))!.AsObject()) {
            if (!new[] {"publicOrigin","bridgePort","inboxPort","relayPort","dashboardPort","otlpHttpPort","otlpGrpcPort","resourcePort"}.Contains(pair.Key))
                throw new InvalidOperationException($"Unsupported machine override: {pair.Key}");
            settings[pair.Key] = pair.Value?.DeepClone();
        }
        return settings;
    }
}
