using System.Text.Json.Nodes;

namespace Aspire.Hosting.Flarestack.Configuration;

internal static class FlarestackLocalConfiguration
{
    internal static JsonObject Read(string path)
    {
        var settings = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        var machineConfigurationPath = Path.Combine(Path.GetDirectoryName(path)!, "local.machine.json");
        if (File.Exists(machineConfigurationPath))
        {
            foreach (var setting in JsonNode.Parse(File.ReadAllText(machineConfigurationPath))!.AsObject())
            {
                if (!new[]
                    {
                        "publicOrigin", "bridgePort", "inboxPort", "relayPort", "dashboardPort",
                        "otlpHttpPort", "otlpGrpcPort", "resourcePort"
                    }.Contains(setting.Key))
                {
                    throw new InvalidOperationException($"Unsupported machine override: {setting.Key}");
                }

                settings[setting.Key] = setting.Value?.DeepClone();
            }
        }

        return settings;
    }
}
