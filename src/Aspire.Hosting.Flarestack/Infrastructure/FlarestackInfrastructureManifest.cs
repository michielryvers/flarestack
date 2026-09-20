using System.Text.Json;

namespace Aspire.Hosting.Flarestack.Infrastructure;

internal sealed record FlarestackInfrastructureManifest(
    string[] DevelopmentCommand,
    string[] WatchCommand,
    string ConfigurationPath)
{
    internal static FlarestackInfrastructureManifest Read(string infrastructureDirectory)
    {
        using var manifest = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(infrastructureDirectory, "package.json")));
        var contract = manifest.RootElement.GetProperty("flarestack");
        if (contract.GetProperty("protocol").GetInt32() != 2 ||
            contract.GetProperty("release").GetString() != "0.1.0-local.2")
        {
            throw new InvalidOperationException(
                "Aspire.Hosting.Flarestack 0.1.0-local.2 expects infrastructure protocol 2 and the same package release. Upgrade the full package set.");
        }

        foreach (var script in new[] { "flarestack:dev", "flarestack:watch" })
        {
            if (!manifest.RootElement.GetProperty("scripts").TryGetProperty(script, out _))
            {
                throw new InvalidOperationException($"Infrastructure package must declare {script}.");
            }
        }

        var scripts = manifest.RootElement.GetProperty("scripts");
        var developmentCommand = FlarestackScript.Parse("flarestack:dev", scripts.GetProperty("flarestack:dev").GetString()!);
        var watchCommand = FlarestackScript.Parse("flarestack:watch", scripts.GetProperty("flarestack:watch").GetString()!);
        if (developmentCommand.Length == 0 || watchCommand.Length == 0)
        {
            throw new InvalidOperationException("Flarestack scripts cannot be empty.");
        }

        var configurationPath = Path.GetFullPath(
            contract.GetProperty("configuration").GetString()!, infrastructureDirectory);
        return new FlarestackInfrastructureManifest(developmentCommand, watchCommand, configurationPath);
    }
}
