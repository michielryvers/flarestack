using Aspire.Hosting.Flarestack;

var builder = DistributedApplication.CreateBuilder(args);
builder.AddFlarestack("cloudflare", "../samples/Todo/infra");
builder.Build().Run();
