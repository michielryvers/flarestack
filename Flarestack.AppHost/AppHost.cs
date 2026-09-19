using Flarestack.Hosting;
using System.Security.Cryptography;

var builder = DistributedApplication.CreateBuilder(args);
var root = Path.GetFullPath("..", builder.AppHostDirectory);
var configuredMode = builder.Configuration["Flarestack:LocalMode"] ?? "Fast";
if (!Enum.TryParse<FlarestackLocalMode>(configuredMode, true, out var mode) || !Enum.IsDefined(mode))
    throw new InvalidOperationException("Flarestack:LocalMode must be Fast or Container.");
var token = builder.AddParameter("local-bridge-token", () => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), secret: true);
var platform = builder.AddFlarestack("cloudflare", root, mode, token);
if (mode == FlarestackLocalMode.Fast)
{
    platform.WithHttpEndpoint(port: 8789, targetPort: 8789, name: "bridge", isProxied: false);
    var web = builder.AddExecutable("todo", "bun", root, "spikes/compatibility/local/watch-dotnet.ts")
        .WithHttpEndpoint(name: "http", isProxied: false)
        .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
        .WithEnvironment("Flarestack__D1__BaseAddress", platform.GetEndpoint("bridge"))
        .WithEnvironment("Flarestack__Authentication__BackchannelBaseAddress", platform.GetEndpoint("bridge"))
        .WithEnvironment("Flarestack__LocalBridgeToken", token)
        .WithOtlpExporter(OtlpProtocol.HttpProtobuf)
        .WithHttpHealthCheck("/health")
        .WaitFor(platform);
    web.WithEnvironment("ASPNETCORE_URLS", web.GetEndpoint("http"));
    platform.WithEnvironment("FLARESTACK_LOCAL_ORIGIN", web.GetEndpoint("http"));
}
builder.Build().Run();
