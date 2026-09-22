using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack.Registration;
using Aspire.Hosting.Pipelines;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Flarestack.Hosting.Tests;

// Aspire.Hosting 13.5.3 requires this opt-in to inspect and execute its custom pipeline API in contract tests.
#pragma warning disable ASPIREPIPELINES001
public sealed class DeploymentPipelineTests : IDisposable
{
    private readonly string directory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".cache", "flarestack", "tmp", "deployment-tests-" + Guid.NewGuid().ToString("N"));

    public DeploymentPipelineTests()
    {
        Directory.CreateDirectory(directory);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Publish_model_has_no_local_application_credentials_or_endpoints(bool legacy)
    {
        var builder = CreateBuilder("staging");
        ExecutableResource platform;
        if (legacy)
        {
            var resources = builder.AddFlarestack("platform", directory);
            Assert.Null(resources.Application);
            platform = resources.Platform.Resource;
        }
        else
        {
            var resources = builder.AddFlarestackPlatform("platform", directory).WithApplication("web");
            Assert.Null(resources.Resource.Application);
            platform = resources.Resource;
        }

        Assert.Single(builder.Resources);
        Assert.Empty(builder.Resources.OfType<ParameterResource>());
        Assert.Empty(platform.Annotations.OfType<EndpointAnnotation>());
        Assert.Empty(platform.Annotations.OfType<EnvironmentCallbackAnnotation>());
        Assert.Empty(platform.Annotations.OfType<WaitAnnotation>());
        Assert.True(platform.IsExcludedFromPublish());
        using var services = new ServiceCollection().BuildServiceProvider();
        var pipeline = Context(builder, services);
        var step = await GetStep(platform, pipeline);
        Assert.Equal("platform-deploy", step.Name);
        Assert.Equal(new[] { WellKnownPipelineSteps.Deploy }, step.RequiredBySteps);
        Assert.Equal(new[] { WellKnownPipelineSteps.DeployPrereq }, step.DependsOnSteps);
        Assert.Same(platform, step.Resource);
        Assert.False(File.Exists(Path.Combine(directory, "invocation.json")));
    }

    [Theory]
    [InlineData("staging")]
    [InlineData("production")]
    public async Task Deploy_runs_manifest_command_in_infrastructure_directory_with_explicit_environment(string environment)
    {
        var command = WriteRunner("""
            await Bun.write("invocation.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
            console.log("Deployment completed.");
            """);
        var builder = CreateBuilder(environment, command: command);
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        var logger = new RecordingLogger();
        var pipeline = Context(builder, services, logger);
        var step = await GetStep(platform.Resource, pipeline);

        await step.Action(StepContext(pipeline));

        using var invocation = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "invocation.json")));
        Assert.Equal(new[] { "deploy", "--environment", environment }, invocation.RootElement.GetProperty("args").EnumerateArray().Select(value => value.GetString()));
        Assert.Equal(directory, invocation.RootElement.GetProperty("cwd").GetString());
        Assert.Contains("Deployment completed.", logger.Messages);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("preview-example")]
    [InlineData("Development")]
    public async Task Nonexplicit_or_unknown_environment_never_starts_the_runner(string environment)
    {
        var command = WriteRunner("await Bun.write('invocation.json', '{}');");
        var builder = CreateBuilder(environment, command: command);
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        var pipeline = Context(builder, services);
        var step = await GetStep(platform.Resource, pipeline);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => step.Action(StepContext(pipeline)));

        Assert.Contains("explicit lowercase", error.Message);
        Assert.False(File.Exists(Path.Combine(directory, "invocation.json")));
    }

    [Theory]
    [InlineData("publish")]
    [InlineData("destroy")]
    [InlineData("platform-deploy")]
    public async Task Other_pipeline_entrypoints_cannot_invoke_cloud_deployment(string target)
    {
        var command = WriteRunner("await Bun.write('invocation.json', '{}');");
        var builder = CreateBuilder("staging", target, command);
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        var pipeline = Context(builder, services);
        var step = await GetStep(platform.Resource, pipeline);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => step.Action(StepContext(pipeline)));

        Assert.Contains("Use aspire deploy", error.Message);
        Assert.False(File.Exists(Path.Combine(directory, "invocation.json")));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("bun run deploy && echo unsafe")]
    public async Task Missing_or_compound_deploy_script_fails_when_deploy_action_runs(string? command)
    {
        var builder = CreateBuilder("staging", command: command);
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        var pipeline = Context(builder, services);
        var step = await GetStep(platform.Resource, pipeline);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => step.Action(StepContext(pipeline)));

        Assert.Contains("flarestack:deploy", error.Message);
    }

    [Fact]
    public async Task Nonzero_exit_fails_the_deploy_step_and_preserves_safe_output()
    {
        var builder = CreateBuilder("staging", command: WriteRunner("console.error('Deployment rejected.'); process.exit(23);"));
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        var logger = new RecordingLogger();
        var pipeline = Context(builder, services, logger);
        var step = await GetStep(platform.Resource, pipeline);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => step.Action(StepContext(pipeline)));

        Assert.Contains("exit code 23", error.Message);
        Assert.Contains("Deployment rejected.", logger.Messages);
    }

    [Fact]
    public async Task Cancellation_stops_the_runner_and_its_child()
    {
        var command = WriteRunner("""
            // Keep a real child alive to verify tree cleanup; this timer is not a test synchronization delay.
            const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 60000)"], { stdout: "ignore", stderr: "ignore" });
            await Bun.write("processes.json", JSON.stringify([process.pid, child.pid]));
            console.log("Runner ready.");
            await child.exited;
            """);
        var builder = CreateBuilder("staging", command: command);
        var platform = builder.AddFlarestackPlatform("platform", directory);
        using var services = new ServiceCollection().BuildServiceProvider();
        using var cancellation = new CancellationTokenSource();
        var logger = new RecordingLogger();
        var pipeline = Context(builder, services, logger, cancellation.Token);
        var step = await GetStep(platform.Resource, pipeline);
        var running = step.Action(StepContext(pipeline));
        var processes = new List<Process>();
        try
        {
            await logger.Ready.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var processIds = JsonSerializer.Deserialize<int[]>(await File.ReadAllTextAsync(Path.Combine(directory, "processes.json")))!;
            processes.AddRange(processIds.Select(Process.GetProcessById));
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running.WaitAsync(TimeSpan.FromSeconds(10)));
            // Kill(entireProcessTree) initiates termination; descendants may exit after the parent has been reaped.
            await Task.WhenAll(processes.Select(process => process.WaitForExitAsync())).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.All(processes, process => Assert.True(process.HasExited));
        }
        finally
        {
            cancellation.Cancel();
            foreach (var process in processes)
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
                process.Dispose();
            }
        }
    }

    private IDistributedApplicationBuilder CreateBuilder(string environment, string target = "deploy", string? command = null)
    {
        var scripts = new JsonObject
        {
            ["flarestack:dev"] = "bun supervisor.ts",
            ["flarestack:watch"] = "dotnet watch"
        };
        if (command is not null)
        {
            scripts["flarestack:deploy"] = command;
        }

        File.WriteAllText(Path.Combine(directory, "package.json"), new JsonObject
        {
            ["flarestack"] = new JsonObject
            {
                ["protocol"] = 2,
                ["release"] = "0.1.0-local.2",
                ["configuration"] = "missing-local.json"
            },
            ["scripts"] = scripts
        }.ToJsonString());
        return DistributedApplication.CreateBuilder(new DistributedApplicationOptions
        {
            ProjectDirectory = directory,
            DisableDashboard = true,
            Args = ["--operation", "publish", "--step", target, "--environment", environment]
        });
    }

    private string WriteRunner(string source)
    {
        var path = Path.Combine(directory, "deployment runner.ts");
        File.WriteAllText(path, source);
        return $"bun \"{path}\"";
    }

    private static PipelineContext Context(IDistributedApplicationBuilder builder, IServiceProvider services, ILogger? logger = null, CancellationToken cancellationToken = default) =>
        new(new DistributedApplicationModel(builder.Resources), builder.ExecutionContext, services, logger ?? new RecordingLogger(), cancellationToken);

    private static PipelineStepContext StepContext(PipelineContext context) =>
        new() { PipelineContext = context, ReportingStep = new UnusedReportingStep() };

    private static async Task<PipelineStep> GetStep(ExecutableResource resource, PipelineContext pipeline)
    {
        var annotation = Assert.Single(resource.Annotations.OfType<PipelineStepAnnotation>());
        return Assert.Single(await annotation.CreateStepsAsync(new PipelineStepFactoryContext { PipelineContext = pipeline, Resource = resource }));
    }

    private sealed class RecordingLogger : ILogger
    {
        public ConcurrentQueue<string> Messages { get; } = new();
        public TaskCompletionSource Ready { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);
            Messages.Enqueue(message);
            if (message == "Runner ready.")
            {
                Ready.TrySetResult();
            }
        }
    }

    private sealed class UnusedReportingStep : IReportingStep
    {
        public Task<IReportingTask> CreateTaskAsync(string statusText, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReportingTask> CreateTaskAsync(MarkdownString statusText, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public void Log(LogLevel logLevel, string message, bool enableMarkdown) => throw new NotSupportedException();
        public void Log(LogLevel logLevel, string message) => throw new NotSupportedException();
        public void Log(LogLevel logLevel, MarkdownString message) => throw new NotSupportedException();
        public Task CompleteAsync(string completionText, CompletionState completionState = CompletionState.Completed, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task CompleteAsync(MarkdownString completionText, CompletionState completionState = CompletionState.Completed, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
#pragma warning restore ASPIREPIPELINES001
