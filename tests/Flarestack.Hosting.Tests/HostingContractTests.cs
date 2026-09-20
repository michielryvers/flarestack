using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using System.Text.Json.Nodes;
using Aspire.Hosting.Flarestack;
using Aspire.Hosting.Flarestack.Configuration;
using Aspire.Hosting.Flarestack.Registration;
using Aspire.Hosting.Flarestack.Resources;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Flarestack.Hosting.Tests;

public sealed class HostingContractTests : IDisposable
{
    private readonly string directory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".cache", "flarestack", "tmp", "hosting-tests-" + Guid.NewGuid().ToString("N"));
    private readonly Dictionary<string, string?> originalEnvironment = new();
    private readonly JsonObject manifest = JsonNode.Parse("""
        {"flarestack":{"protocol":2,"release":"0.1.0-local.2","configuration":"local.json"},
         "scripts":{"flarestack:dev":"bun run supervisor.ts","flarestack:watch":"dotnet watch --project 'My App.csproj'"}}
        """)!.AsObject();
    private readonly JsonObject settings = JsonNode.Parse("""
        {"publicOrigin":"http://127.0.0.1:8787","bridgePort":8788,"inboxPort":8810,
         "buildRoot":".","project":"My App.csproj"}
        """)!.AsObject();

    public HostingContractTests()
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "My App.csproj"), "<Project />");
        File.WriteAllText(Path.Combine(directory, "alchemy.run.ts"), "");
        SetEnvironment("PUBLIC_ORIGIN", null);
    }

    [Theory]
    [InlineData(FlarestackLocalMode.Fast, 2, false)]
    [InlineData(FlarestackLocalMode.Container, 1, false)]
    [InlineData(FlarestackLocalMode.Fast, 2, true)]
    [InlineData(FlarestackLocalMode.Container, 1, true)]
    public async Task Mode_preserves_Alchemy_ownership_and_fast_mode_bridge(FlarestackLocalMode mode, int executableCount, bool typed)
    {
        var builder = CreateBuilder();
        FlarestackResources resources;
        if (typed)
        {
            var platform = builder.AddFlarestackPlatform("platform", directory, mode);
            Assert.Null(platform.Resource.Application);
            Assert.Same(platform, platform.WithApplication("web"));
            Assert.Equal(mode, platform.Resource.Mode);
            var application = platform.Resource.Application is { } watcher
                ? builder.CreateResourceBuilder(watcher)
                : null;
            resources = new FlarestackResources(platform, application);
        }
        else
        {
            resources = builder.AddFlarestack("platform", directory, options =>
            {
                options.Mode = mode;
                options.ApplicationName = "web";
            });
        }

        Assert.Equal(executableCount, builder.Resources.OfType<ExecutableResource>().Count());
        Assert.Empty(builder.Resources.OfType<ContainerResource>());
        Assert.Equal("bun", resources.Platform.Resource.Command);
        Assert.Equal(new object[] { "run", "supervisor.ts" }, await GetArguments(resources.Platform.Resource));
        AssertEndpoint(resources.Platform.Resource, "http", 8787);
        AssertEndpoint(resources.Platform.Resource, "inbox", 8810);
        Assert.Single(resources.Platform.Resource.Annotations.OfType<HealthCheckAnnotation>());
        Assert.Empty(resources.Platform.Resource.Annotations.OfType<WaitAnnotation>());
        var platformEnvironment = await GetEnvironment(builder, resources.Platform.Resource);
        Assert.Equal(mode.ToString(), platformEnvironment["FLARESTACK_LOCAL_MODE"]);
        Assert.Equal("1", platformEnvironment["FLARESTACK_EXTERNAL_OTLP"]);
        Assert.Equal("http/protobuf", platformEnvironment["OTEL_EXPORTER_OTLP_PROTOCOL"]);
        Assert.True(platformEnvironment.ContainsKey("OTEL_EXPORTER_OTLP_ENDPOINT"));
        var token = Assert.IsType<ParameterResource>(platformEnvironment["FLARESTACK_LOCAL_BRIDGE_TOKEN"]);
        Assert.True(token.Secret);

        if (mode == FlarestackLocalMode.Container)
        {
            Assert.Null(resources.Application);
            Assert.DoesNotContain(resources.Platform.Resource.Annotations.OfType<EndpointAnnotation>(), endpoint => endpoint.Name == "bridge");
            Assert.False(platformEnvironment.ContainsKey("FLARESTACK_LOCAL_ORIGIN"));
            return;
        }

        AssertEndpoint(resources.Platform.Resource, "bridge", 8788);
        var app = Assert.IsAssignableFrom<IResourceBuilder<ExecutableResource>>(resources.Application);
        Assert.Equal("web", app.Resource.Name);
        Assert.Equal("dotnet", app.Resource.Command);
        Assert.Equal(new object[] { "watch", "--project", "My App.csproj" }, await GetArguments(app.Resource));
        Assert.Single(app.Resource.Annotations.OfType<HealthCheckAnnotation>());
        var wait = Assert.Single(app.Resource.Annotations.OfType<WaitAnnotation>());
        Assert.Same(resources.Platform.Resource, wait.Resource);
        Assert.Equal(WaitType.WaitUntilHealthy, wait.WaitType);
        var appEnvironment = await GetEnvironment(builder, app.Resource);
        Assert.Same(token, appEnvironment["Flarestack__LocalBridgeToken"]);
        Assert.Equal("http/protobuf", appEnvironment["OTEL_EXPORTER_OTLP_PROTOCOL"]);
        Assert.True(appEnvironment.ContainsKey("OTEL_EXPORTER_OTLP_ENDPOINT"));
        Assert.Equal("http://127.0.0.1:8787/auth", appEnvironment["Flarestack__Authentication__Authority"]);
        foreach (var key in new[] { "Flarestack__D1__BaseAddress", "Flarestack__Email__BaseAddress", "Flarestack__Authentication__BackchannelBaseAddress" })
        {
            var endpoint = Assert.IsType<EndpointReference>(appEnvironment[key]);
            Assert.Equal("bridge", endpoint.EndpointName);
            Assert.Same(resources.Platform.Resource, endpoint.Resource);
        }
        var appOrigin = Assert.IsType<EndpointReference>(platformEnvironment["FLARESTACK_LOCAL_ORIGIN"]);
        Assert.Same(app.Resource, appOrigin.Resource);
        Assert.Equal("http", appOrigin.EndpointName);
    }

    [Theory]
    [InlineData(FlarestackLocalMode.Fast)]
    [InlineData(FlarestackLocalMode.Container)]
    public async Task Duplicate_attachment_is_rejected_without_changing_the_graph(FlarestackLocalMode mode)
    {
        var builder = CreateBuilder();
        var platform = builder.AddFlarestackPlatform("platform", directory, mode).WithApplication("web");
        var resources = builder.Resources.ToArray();
        var application = platform.Resource.Application;
        var environment = await GetEnvironment(builder, platform.Resource);

        Assert.Throws<InvalidOperationException>(() => platform.WithApplication("another-app"));

        Assert.Equal(resources, builder.Resources.ToArray());
        Assert.Same(application, platform.Resource.Application);
        Assert.Equal(environment.Keys.Order(), (await GetEnvironment(builder, platform.Resource)).Keys.Order());
    }

    [Theory]
    [InlineData(FlarestackLocalMode.Fast, "")]
    [InlineData(FlarestackLocalMode.Fast, "invalid name")]
    [InlineData(FlarestackLocalMode.Fast, "platform")]
    [InlineData(FlarestackLocalMode.Container, "invalid--name")]
    [InlineData(FlarestackLocalMode.Container, "PLATFORM")]
    public void Invalid_attachment_name_does_not_consume_the_attachment(FlarestackLocalMode mode, string name)
    {
        var builder = CreateBuilder();
        var platform = builder.AddFlarestackPlatform("platform", directory, mode);
        var resources = builder.Resources.ToArray();

        Assert.ThrowsAny<ArgumentException>(() => platform.WithApplication(name));
        Assert.Equal(resources, builder.Resources.ToArray());
        Assert.Null(platform.Resource.Application);
        platform.WithApplication("valid-app");
        Assert.Throws<InvalidOperationException>(() => platform.WithApplication("another-app"));
    }

    [Theory]
    [InlineData(FlarestackLocalMode.Fast, false)]
    [InlineData(FlarestackLocalMode.Fast, true)]
    [InlineData(FlarestackLocalMode.Container, false)]
    [InlineData(FlarestackLocalMode.Container, true)]
    public async Task Before_start_requires_fast_mode_attachment_only(FlarestackLocalMode mode, bool attach)
    {
        var builder = CreateBuilder();
        var platform = builder.AddFlarestackPlatform("platform", directory, mode);
        if (attach)
        {
            platform.WithApplication();
        }

        // Aspire's before-start subscriber allocates DCP names. These model-only tests never launch either binary.
        builder.Configuration["DcpPublisher:CliPath"] = Path.Combine(directory, "model-only-dcp");
        builder.Configuration["DcpPublisher:DashboardPath"] = Path.Combine(directory, "model-only-dashboard");
        builder.Services.AddLogging(logging => logging.ClearProviders());
        using var application = builder.Build();
        var beforeStart = new BeforeStartEvent(application.Services, new DistributedApplicationModel(builder.Resources));
        if (mode == FlarestackLocalMode.Fast && !attach)
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => builder.Eventing.PublishAsync(beforeStart));
            Assert.Contains("WithApplication", error.Message);
        }
        else
        {
            await builder.Eventing.PublishAsync(beforeStart);
        }
    }

    [Fact]
    public void Platform_cannot_be_attached_through_another_application_builder()
    {
        var owner = CreateBuilder();
        var platform = owner.AddFlarestackPlatform("platform", directory);
        var other = CreateBuilder();
        var foreignBuilder = other.CreateResourceBuilder(platform.Resource);

        Assert.Throws<InvalidOperationException>(() => foreignBuilder.WithApplication("web"));
        Assert.Null(platform.Resource.Application);
        Assert.Empty(other.Resources);
        platform.WithApplication("web");
        Assert.NotNull(platform.Resource.Application);
    }

    [Fact]
    public void Typed_platform_supports_standard_endpoint_references()
    {
        var builder = CreateBuilder();
        var platform = builder.AddFlarestackPlatform("platform", directory)
            .WithEnvironment("CUSTOM_SETTING", "configured")
            .WithApplication();

        Assert.IsType<FlarestackPlatformResource>(platform.Resource);
        Assert.Same(platform.Resource, platform.GetEndpoint("http").Resource);
        Assert.Same(platform.Resource, platform.GetEndpoint("inbox").Resource);
        Assert.Same(platform.Resource, platform.GetEndpoint("bridge").Resource);
    }

    [Theory]
    [InlineData("https://todo.example.com")]
    [InlineData("http://localhost:12345")]
    public async Task Explicit_origin_is_shared_by_platform_and_authentication(string origin)
    {
        SetEnvironment("PUBLIC_ORIGIN", origin);
        var builder = CreateBuilder();
        var resources = builder.AddFlarestack("platform", directory);
        Assert.Equal(origin, (await GetEnvironment(builder, resources.Platform.Resource))["PUBLIC_ORIGIN"]);
        Assert.Equal(origin + "/auth", (await GetEnvironment(builder, resources.Application!.Resource))["Flarestack__Authentication__Authority"]);
    }

    [Theory]
    [InlineData("http://example.com")]
    [InlineData("https://example.com/path")]
    [InlineData("https://example.com?query=1")]
    [InlineData("not-an-origin")]
    public void Invalid_explicit_origins_are_rejected(string origin)
    {
        SetEnvironment("PUBLIC_ORIGIN", origin);
        var builder = CreateBuilder();
        Assert.Throws<InvalidOperationException>(() => builder.AddFlarestack("platform", directory));
    }

    [Theory]
    [InlineData("protocol", "1")]
    [InlineData("release", "\"0.0.0\"")]
    public void Mismatched_package_contract_is_rejected(string key, string value)
    {
        manifest["flarestack"]![key] = JsonNode.Parse(value);
        var builder = CreateBuilder();
        Assert.Throws<InvalidOperationException>(() => builder.AddFlarestack("platform", directory));
        Assert.Empty(builder.Resources);
    }

    [Theory]
    [InlineData("flarestack:dev", "bun run dev && echo done")]
    [InlineData("flarestack:watch", "dotnet watch | tee log")]
    [InlineData("flarestack:dev", "bun run $COMMAND")]
    [InlineData("flarestack:watch", "dotnet watch; echo done")]
    [InlineData("flarestack:dev", "")]
    public void Commands_that_cannot_be_owned_directly_are_rejected(string script, string command)
    {
        manifest["scripts"]![script] = command;
        var builder = CreateBuilder();
        Assert.Throws<InvalidOperationException>(() => builder.AddFlarestack("platform", directory));
        Assert.Empty(builder.Resources);
    }

    [Fact]
    public void Unknown_mode_is_rejected_before_resources_are_added()
    {
        var builder = CreateBuilder();
        Assert.Throws<ArgumentException>(() => builder.AddFlarestack("platform", directory, options => options.Mode = (FlarestackLocalMode)42));
        Assert.Empty(builder.Resources);
    }

    [Fact]
    public void Machine_ports_apply_to_dashboard_and_resource_model()
    {
        WriteMachine("""
            {"publicOrigin":"http://127.0.0.1:9787","bridgePort":9788,"inboxPort":9810,
             "dashboardPort":19000,"otlpHttpPort":19001,"otlpGrpcPort":19002,"resourcePort":19003}
            """);
        var dashboardVariables = new[] { "ASPNETCORE_URLS", "ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL", "ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL", "ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL" };
        foreach (var variable in dashboardVariables)
        {
            SetEnvironment(variable, null);
        }
        var builder = CreateBuilder();
        FlarestackLocal.Configure(directory, Path.Combine(directory, "AppHost.cs"));
        for (var index = 0; index < dashboardVariables.Length; index++)
        {
            Assert.Equal($"http://127.0.0.1:{19000 + index}", Environment.GetEnvironmentVariable(dashboardVariables[index]));
        }
        var resources = builder.AddFlarestack("platform", directory);
        AssertEndpoint(resources.Platform.Resource, "http", 9787);
        AssertEndpoint(resources.Platform.Resource, "bridge", 9788);
        AssertEndpoint(resources.Platform.Resource, "inbox", 9810);
    }

    [Theory]
    [InlineData("project")]
    [InlineData("buildRoot")]
    [InlineData("unknownSetting")]
    public void Machine_overrides_cannot_change_application_configuration(string key)
    {
        WriteMachine(new JsonObject { [key] = "replacement" }.ToJsonString());
        var builder = CreateBuilder();
        Assert.Throws<InvalidOperationException>(() => builder.AddFlarestack("platform", directory));
        Assert.Throws<InvalidOperationException>(() => FlarestackLocal.Configure(directory, Path.Combine(directory, "AppHost.cs")));
    }

    private IDistributedApplicationBuilder CreateBuilder()
    {
        File.WriteAllText(Path.Combine(directory, "package.json"), manifest.ToJsonString());
        File.WriteAllText(Path.Combine(directory, "local.json"), settings.ToJsonString());
        var builder = DistributedApplication.CreateBuilder(new DistributedApplicationOptions
        {
            ProjectDirectory = directory,
            DisableDashboard = true,
            Args = []
        });
        builder.Configuration["ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL"] = "http://127.0.0.1:19001";
        return builder;
    }

    private void WriteMachine(string json) => File.WriteAllText(Path.Combine(directory, "local.machine.json"), json);

    private static void AssertEndpoint(ExecutableResource resource, string name, int port)
    {
        var endpoint = Assert.Single(resource.Annotations.OfType<EndpointAnnotation>(), endpoint => endpoint.Name == name);
        Assert.Equal(port, endpoint.Port);
        Assert.Equal(port, endpoint.TargetPort);
        Assert.False(endpoint.IsProxied);
    }

    private static async Task<Dictionary<string, object>> GetEnvironment(IDistributedApplicationBuilder builder, ExecutableResource resource)
    {
        var values = new Dictionary<string, object>();
        var context = new EnvironmentCallbackContext(builder.ExecutionContext, resource, values, CancellationToken.None);
        foreach (var annotation in resource.Annotations.OfType<EnvironmentCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }
        return values;
    }

    private static async Task<IReadOnlyList<object>> GetArguments(ExecutableResource resource)
    {
        var arguments = new List<object>();
        var context = new CommandLineArgsCallbackContext(arguments, resource);
        foreach (var annotation in resource.Annotations.OfType<CommandLineArgsCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }

        return arguments;
    }

    private void SetEnvironment(string name, string? value)
    {
        originalEnvironment.TryAdd(name, Environment.GetEnvironmentVariable(name));
        Environment.SetEnvironmentVariable(name, value);
    }

    public void Dispose()
    {
        foreach (var (name, value) in originalEnvironment)
        {
            Environment.SetEnvironmentVariable(name, value);
        }
        Directory.Delete(directory, recursive: true);
    }
}
