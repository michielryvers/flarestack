using Flarestack.Hosting;

FlarestackLocal.Configure("../samples/Todo/infra");
var builder = DistributedApplication.CreateBuilder(args);
var configuredMode = builder.Configuration["Flarestack:LocalMode"] ?? "Fast";
if (!Enum.TryParse<FlarestackLocalMode>(configuredMode, true, out var mode) || !Enum.IsDefined(mode))
    throw new InvalidOperationException("Flarestack:LocalMode must be Fast or Container.");
builder.AddFlarestack("cloudflare", "../samples/Todo/infra", options =>
{
    options.Mode = mode;
    options.ApplicationName = "todo";
});
builder.Build().Run();
