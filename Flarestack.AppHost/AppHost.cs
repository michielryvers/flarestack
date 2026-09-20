using Aspire.Hosting.Flarestack;
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Registration;

FlarestackLocal.Configure("../samples/Todo/infra");
var builder = DistributedApplication.CreateBuilder(args);
var configuredMode = builder.Configuration["Flarestack:LocalMode"] ?? "Fast";
if (!Enum.TryParse<FlarestackLocalMode>(configuredMode, true, out var mode) || !Enum.IsDefined(mode))
    throw new InvalidOperationException("Flarestack:LocalMode must be Fast or Container.");
builder.AddFlarestackPlatform("cloudflare", "../samples/Todo/infra", mode)
    .WithApplication("todo");
builder.Build().Run();
