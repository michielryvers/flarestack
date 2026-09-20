using System.Text.Json.Nodes;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack;
using Aspire.Hosting.Flarestack.Registration;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Flarestack.Hosting.Tests;

public sealed class CanonicalHostingTests : IDisposable
{
    private static readonly string[] EndpointKeys =
    [
        "ASPNETCORE_URLS", "ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL",
        "ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL", "ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL"
    ];
    private readonly string directory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".cache", "flarestack", "tmp", "canonical-hosting-tests-" + Guid.NewGuid().ToString("N"));

    public CanonicalHostingTests()
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "App.csproj"), "<Project />");
        File.WriteAllText(Path.Combine(directory, "alchemy.run.ts"), "");
        File.WriteAllText(Path.Combine(directory, "package.json"), """
            {"flarestack":{"protocol":2,"release":"0.1.0-local.2","configuration":"local.json"},
             "scripts":{"flarestack:dev":"bun supervisor.ts","flarestack:watch":"dotnet watch --project App.csproj"}}
            """);
        File.WriteAllText(Path.Combine(directory, "local.json"), """
            {"publicOrigin":"http://127.0.0.1:8787","bridgePort":8788,"inboxPort":8810,
             "buildRoot":".","project":"App.csproj"}
            """);
    }

    [Fact]
    public void Headline_call_uses_distinct_predictable_names_with_both_namespaces_imported()
    {
        var builder = CreateBuilder();

        var resources = builder.AddFlarestack("app", directory);

        Assert.Equal("app", resources.Platform.Resource.Name);
        Assert.Equal("app-app", resources.Application!.Resource.Name);
        Assert.Equal(2, builder.Resources.OfType<ExecutableResource>().Count());
    }

    [Theory]
    [InlineData("Fast", true)]
    [InlineData("fast", true)]
    [InlineData("Container", false)]
    public async Task Configuration_selects_mode_and_application_name(string mode, bool hasWatcher)
    {
        var builder = CreateBuilder("--Flarestack:LocalMode", mode, "--Flarestack:ApplicationName", "web");

        var resources = builder.AddFlarestack("platform", directory);

        Assert.Equal(hasWatcher, resources.Application is not null);
        if (hasWatcher)
        {
            Assert.Equal("web", resources.Application!.Resource.Name);
            var environment = await GetEnvironment(builder, resources.Application.Resource);
            Assert.IsType<EndpointReference>(environment["Flarestack__D1__BaseAddress"]);
            Assert.IsType<ParameterResource>(environment["Flarestack__LocalBridgeToken"]);
        }
        else
        {
            Assert.Single(builder.Resources.OfType<ExecutableResource>());
            Assert.Empty(builder.Resources.OfType<ContainerResource>());
        }
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("42")]
    public void Invalid_mode_fails_before_adding_resources(string mode)
    {
        var builder = CreateBuilder("--Flarestack:LocalMode", mode);

        Assert.Throws<InvalidOperationException>(() => builder.AddFlarestack("platform", directory));

        Assert.Empty(builder.Resources);
    }

    [Fact]
    public async Task Machine_ports_apply_after_builder_creation_and_reach_OTLP_without_environment_mutation()
    {
        var processEnvironment = EndpointKeys.Select(Environment.GetEnvironmentVariable).ToArray();
        var builder = CreateBuilder();
        builder.Configuration.AddInMemoryCollection(EndpointKeys.Select(key => new KeyValuePair<string, string?>(key, "http://127.0.0.1:9999")));
        builder.Configuration["Caller:Preserved"] = "configured-before-registration";
        WriteMachinePorts(19000);

        var resources = builder.AddFlarestack("platform", directory);

        for (var index = 0; index < EndpointKeys.Length; index++)
        {
            Assert.Equal($"http://127.0.0.1:{19000 + index}", builder.Configuration[EndpointKeys[index]]);
            Assert.Equal(processEnvironment[index], Environment.GetEnvironmentVariable(EndpointKeys[index]));
        }
        Assert.Equal("configured-before-registration", builder.Configuration["Caller:Preserved"]);
        var environment = await GetEnvironment(builder, resources.Platform.Resource);
        Assert.Equal("http://127.0.0.1:19001", await Assert.IsAssignableFrom<IValueProvider>(environment["OTEL_EXPORTER_OTLP_ENDPOINT"]).GetValueAsync(CancellationToken.None));
        Assert.Equal("http/protobuf", environment["OTEL_EXPORTER_OTLP_PROTOCOL"]);
    }

    [Fact]
    public async Task Explicit_CLI_endpoint_values_take_precedence_over_machine_ports()
    {
        WriteMachinePorts(19000);
        var arguments = EndpointKeys.SelectMany((key, index) => new[] { "--" + key, $"http://127.0.0.1:{20000 + index}" }).ToArray();
        var builder = CreateBuilder(arguments);

        var resources = builder.AddFlarestack("platform", directory);

        for (var index = 0; index < EndpointKeys.Length; index++)
        {
            Assert.Equal($"http://127.0.0.1:{20000 + index}", builder.Configuration[EndpointKeys[index]]);
        }
        var environment = await GetEnvironment(builder, resources.Platform.Resource);
        Assert.Equal("http://127.0.0.1:20001", await Assert.IsAssignableFrom<IValueProvider>(environment["OTEL_EXPORTER_OTLP_ENDPOINT"]).GetValueAsync(CancellationToken.None));
    }

    [Fact]
    public void Separate_builders_keep_their_own_machine_port_configuration()
    {
        WriteMachinePorts(19000);
        var first = CreateBuilder();
        first.AddFlarestack("first", directory);
        WriteMachinePorts(20000);
        var second = CreateBuilder();
        second.AddFlarestack("second", directory);

        Assert.Equal("http://127.0.0.1:19000", first.Configuration[EndpointKeys[0]]);
        Assert.Equal("http://127.0.0.1:20000", second.Configuration[EndpointKeys[0]]);
    }

    [Fact]
    public void Without_machine_ports_existing_Aspire_endpoints_are_unchanged()
    {
        var builder = CreateBuilder();
        builder.Configuration.AddInMemoryCollection(EndpointKeys.Select(key => new KeyValuePair<string, string?>(key, "http://127.0.0.1:19999")));

        builder.AddFlarestack("platform", directory);

        Assert.All(EndpointKeys, key => Assert.Equal("http://127.0.0.1:19999", builder.Configuration[key]));
    }

    [Fact]
    public void Publish_mode_ignores_local_configuration_and_does_not_mutate_endpoints()
    {
        File.Delete(Path.Combine(directory, "local.json"));
        File.WriteAllText(Path.Combine(directory, "local.machine.json"), "invalid-json");
        var builder = CreateBuilder("--operation", "publish", "--step", "deploy", "--environment", "staging", "--Flarestack:LocalMode", "invalid");
        var endpoints = EndpointKeys.Select(key => builder.Configuration[key]).ToArray();

        var resources = builder.AddFlarestack("platform", directory);

        Assert.Null(resources.Application);
        Assert.Single(builder.Resources);
        Assert.Empty(builder.Resources.OfType<ParameterResource>());
        Assert.Equal(endpoints, EndpointKeys.Select(key => builder.Configuration[key]));
    }

    [Fact]
    public void Legacy_explicit_registration_retains_its_configuration_behavior()
    {
        WriteMachinePorts(19000);
        var builder = CreateBuilder("--Flarestack:LocalMode", "Container");
        builder.Configuration[EndpointKeys[0]] = "http://127.0.0.1:19999";

        var resources = Aspire.Hosting.Flarestack.Registration.FlarestackHosting.AddFlarestack(builder, "platform", directory);

        Assert.Equal("app", resources.Application!.Resource.Name);
        Assert.Equal("http://127.0.0.1:19999", builder.Configuration[EndpointKeys[0]]);
    }

    private IDistributedApplicationBuilder CreateBuilder(params string[] args)
    {
        var builder = DistributedApplication.CreateBuilder(new DistributedApplicationOptions { ProjectDirectory = directory, DisableDashboard = true, Args = args });
        // Match the launch profile's OTLP endpoint for model tests that evaluate environment callbacks.
        if (builder.Configuration[EndpointKeys[1]] is null)
        {
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { [EndpointKeys[1]] = "http://127.0.0.1:4318" });
        }
        return builder;
    }

    private void WriteMachinePorts(int startingPort) => File.WriteAllText(Path.Combine(directory, "local.machine.json"), new JsonObject
    {
        ["dashboardPort"] = startingPort,
        ["otlpHttpPort"] = startingPort + 1,
        ["otlpGrpcPort"] = startingPort + 2,
        ["resourcePort"] = startingPort + 3
    }.ToJsonString());

    private static async Task<Dictionary<string, object>> GetEnvironment(IDistributedApplicationBuilder builder, ExecutableResource resource)
    {
        var environment = new Dictionary<string, object>();
        var context = new EnvironmentCallbackContext(builder.ExecutionContext, resource, environment, CancellationToken.None);
        foreach (var annotation in resource.Annotations.OfType<EnvironmentCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }
        return environment;
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
