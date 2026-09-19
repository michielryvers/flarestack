using Flarestack.Hosting;

var builder = DistributedApplication.CreateBuilder(args);
var configuredMode = builder.Configuration["Flarestack:LocalMode"] ?? "Fast";
if (!Enum.TryParse<FlarestackLocalMode>(configuredMode, true, out var mode) || !Enum.IsDefined(mode))
    throw new InvalidOperationException("Flarestack:LocalMode must be Fast or Container.");
builder.AddFlarestack("cloudflare", new FlarestackOptions("../samples/Todo/local.json", "../samples/Todo/infra/node_modules/@flarestack/alchemy/local")
{
    Mode = mode,
    ApplicationName = "todo",
});
builder.Build().Run();
