using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using Aspire.Hosting.Flarestack.Infrastructure;
using Microsoft.Extensions.Logging;

namespace Aspire.Hosting.Flarestack.Deployment;

internal static class FlarestackDeploymentProcess
{
    internal static async Task RunAsync(string infrastructureDirectory, string environment, ILogger logger, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var command = ReadCommand(infrastructureDirectory);
        var startInfo = new ProcessStartInfo(command[0])
        {
            WorkingDirectory = infrastructureDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in command.Skip(1))
        {
            startInfo.ArgumentList.Add(argument);
        }

        startInfo.ArgumentList.Add("deploy");
        startInfo.ArgumentList.Add("--environment");
        startInfo.ArgumentList.Add(environment);

        using var process = new Process { StartInfo = startInfo };
        try
        {
            process.Start();
        }
        catch (Win32Exception)
        {
            throw new InvalidOperationException("Unable to start flarestack:deploy. Check that Bun and the infrastructure dependencies are installed.");
        }

        var stdout = ForwardOutputAsync(process.StandardOutput, logger, LogLevel.Information);
        var stderr = ForwardOutputAsync(process.StandardError, logger, LogLevel.Warning);
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (InvalidOperationException) when (process.HasExited)
                {
                    // The process completed between the exit check and cancellation cleanup.
                    await process.WaitForExitAsync(CancellationToken.None);
                }
            }

            await process.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(stdout, stderr);
            throw;
        }

        await Task.WhenAll(stdout, stderr);
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"Flarestack deployment failed with exit code {process.ExitCode}. Inspect the deployment step output.");
        }
    }

    private static string[] ReadCommand(string infrastructureDirectory)
    {
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(infrastructureDirectory, "package.json")));
        if (!manifest.RootElement.TryGetProperty("scripts", out var scripts) ||
            !scripts.TryGetProperty("flarestack:deploy", out var script) ||
            script.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(script.GetString()))
        {
            throw new InvalidOperationException("Infrastructure package.json must declare a flarestack:deploy script pointing to the Flarestack deployment runner.");
        }

        var command = FlarestackScript.Parse("flarestack:deploy", script.GetString()!);
        if (command.Length == 0)
        {
            throw new InvalidOperationException("The flarestack:deploy script must contain one executable command.");
        }

        return command;
    }

    private static async Task ForwardOutputAsync(StreamReader reader, ILogger logger, LogLevel level)
    {
        while (await reader.ReadLineAsync() is { } line)
        {
            // The package runner owns sanitization and OTLP export. Never log its raw child environment or arguments here.
            logger.Log(level, "{DeploymentOutput}", line);
        }
    }
}
