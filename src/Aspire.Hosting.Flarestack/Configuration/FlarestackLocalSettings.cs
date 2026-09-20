using System.Text.Json;

namespace Aspire.Hosting.Flarestack.Configuration;

internal sealed record FlarestackLocalSettings(Uri ListenerOrigin, string PublicOrigin, int BridgePort, int InboxPort)
{
    internal static FlarestackLocalSettings Read(string configurationPath, string infrastructureDirectory)
    {
        var configurationDirectory = Path.GetDirectoryName(configurationPath)!;
        using var configuration = JsonDocument.Parse(FlarestackLocalConfiguration.Read(configurationPath).ToJsonString());

        string ReadRequiredString(string key) => configuration.RootElement.GetProperty(key).GetString() is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing Flarestack local setting: {key}");

        var origin = new Uri(ReadRequiredString("publicOrigin"));
        var publicOrigin = Environment.GetEnvironmentVariable("PUBLIC_ORIGIN") ?? origin.GetLeftPart(UriPartial.Authority);
        if (!Uri.TryCreate(publicOrigin, UriKind.Absolute, out var externalOrigin) ||
            externalOrigin.GetLeftPart(UriPartial.Authority) != publicOrigin ||
            (externalOrigin.Scheme != "https" && !(externalOrigin.IsLoopback && externalOrigin.Scheme == "http")))
        {
            throw new InvalidOperationException("PUBLIC_ORIGIN must be an HTTPS origin or loopback HTTP origin.");
        }

        var bridgePort = configuration.RootElement.GetProperty("bridgePort").GetInt32();
        if (!origin.IsLoopback || origin.Scheme != "http" || origin.AbsolutePath != "/" || origin.Query.Length > 0 ||
            origin.UserInfo.Length > 0 || origin.Fragment.Length > 0)
        {
            throw new InvalidOperationException("Local publicOrigin must be a loopback HTTP origin.");
        }

        if (bridgePort is < 1 or > 65535 || bridgePort == origin.Port)
        {
            throw new InvalidOperationException("Invalid bridgePort.");
        }

        var inboxPort = configuration.RootElement.TryGetProperty("inboxPort", out var inbox) ? inbox.GetInt32() : 8810;
        if (inboxPort is < 1 or > 65535 || inboxPort == bridgePort || inboxPort == origin.Port)
        {
            throw new InvalidOperationException("Invalid inboxPort.");
        }

        // Resolve buildRoot even though resource composition does not use it, preserving input validation.
        _ = Path.GetFullPath(ReadRequiredString("buildRoot"), configurationDirectory);
        var project = Path.GetFullPath(ReadRequiredString("project"), configurationDirectory);
        foreach (var path in new[] { project, Path.Combine(infrastructureDirectory, "alchemy.run.ts") })
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Flarestack input not found.", path);
            }
        }

        return new FlarestackLocalSettings(origin, publicOrigin, bridgePort, inboxPort);
    }
}
