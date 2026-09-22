using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Flarestack.Resources;
using Aspire.Hosting.Pipelines;

namespace Aspire.Hosting.Flarestack.Deployment;

// Aspire.Hosting 13.5.3 marks its supported custom deployment pipeline API experimental.
// Keep the opt-in inside this adapter; do not propagate the experimental API into Flarestack's public surface.
#pragma warning disable ASPIREPIPELINES001
internal static class FlarestackDeploymentPipeline
{
    internal static void Configure(IResourceBuilder<FlarestackPlatformResource> platform)
    {
        var builder = platform.ApplicationBuilder;
        var environment = builder.Environment.EnvironmentName;
        platform.WithPipelineStepFactory(_ => new PipelineStep
        {
            Name = $"{platform.Resource.Name}-deploy",
            Description = "Deploy the selected Flarestack environment through Alchemy.",
            Resource = platform.Resource,
            DependsOnSteps = [WellKnownPipelineSteps.DeployPrereq],
            RequiredBySteps = [WellKnownPipelineSteps.Deploy],
            Action = async context =>
            {
                if (builder.Configuration["Pipeline:Step"] != WellKnownPipelineSteps.Deploy)
                {
                    throw new InvalidOperationException("Use aspire deploy --environment staging or --environment production to deploy Flarestack.");
                }

                if (environment is not ("staging" or "production"))
                {
                    throw new InvalidOperationException("Flarestack deployment requires an explicit lowercase --environment staging or --environment production.");
                }

                await FlarestackDeploymentProcess.RunAsync(
                    platform.Resource.WorkingDirectory, environment, context.Logger, context.CancellationToken);
                context.Summary.Add("Flarestack environment", environment);
            }
        });
    }
}
#pragma warning restore ASPIREPIPELINES001
