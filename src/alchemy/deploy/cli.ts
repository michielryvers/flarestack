import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { deploymentEnvironment, deploymentOrigin, DeploymentError, loadDeployment } from "./config.ts";
import { assertDeploymentSafetySupport, assertDestroyConfirmation, parseArguments, stageBuild } from "./safety.ts";
import { deploymentLogs } from "./telemetry.ts";
import { resolveCloudAccount } from "./account.ts";
import { smokeDeployment } from "./smoke.ts";
import { readLines } from "../local/logs.ts";
import { protocolVersion, releaseVersion } from "../protocol.ts";

export async function runDeployment(args: string[]) {
  const parsed = parseArguments(args);
  const environment = deploymentEnvironment(parsed.environment);
  const deployment = loadDeployment(parsed.configuration, environment);
  if (parsed.action === "destroy") {
    let confirmation = parsed.confirmation;
    if (confirmation === undefined && process.stdin.isTTY && process.stdout.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { confirmation = await prompt.question(`Permanently delete ${deployment.identity}, including its D1 database? Type the exact identity: `); }
      finally { prompt.close(); }
    }
    assertDestroyConfirmation(deployment.identity, confirmation);
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  let log: Awaited<ReturnType<typeof deploymentLogs>> | undefined;
  let child: Bun.Subprocess | undefined;
  const kill = () => { child?.kill("SIGTERM"); };
  abort.signal.addEventListener("abort", kill);
  try {
    log = await deploymentLogs(abort.signal, () => abort.abort(new DeploymentError("The deployment log receiver exited; deployment was cancelled.")), { environment });
    const logger = log;
    if (Bun.version !== "1.4.2") throw new DeploymentError("This Flarestack release requires Bun 1.4.2. Install that pinned version and retry.");
    const manifest = JSON.parse(await readFile(resolve(deployment.local.infra, "package.json"), "utf8"));
    if (manifest.flarestack?.protocol !== protocolVersion || manifest.flarestack?.release !== releaseVersion) throw new DeploymentError("Infrastructure and @flarestack/alchemy must use the same release and protocol. Upgrade the complete package set.");
    const entry = Bun.resolveSync("alchemy", deployment.local.infra);
    const packagePath = fileURLToPath(new URL("../package.json", pathToFileURL(entry)));
    const alchemyPackage = JSON.parse(await readFile(packagePath, "utf8"));
    if (alchemyPackage.version !== "2.0.0-beta.79") throw new DeploymentError("This Flarestack release requires Alchemy 2.0.0-beta.79.");
    const engine = await import(Bun.resolveSync("alchemy/Apply", deployment.local.infra));
    assertDeploymentSafetySupport(engine.flarestackNonDestructiveApplyVersion);
    const cli = fileURLToPath(new URL("../bin/cli.js", pathToFileURL(entry)));
    const childEnvironment: Record<string, string | undefined> = { ...process.env };
    // A deployment never inherits the local supervisor's bridge/relay credentials or local endpoints.
    for (const key of Object.keys(childEnvironment)) {
      if (key.startsWith("FLARESTACK_LOCAL_") || key.startsWith("OTEL_") || key === "FLARESTACK_EXTERNAL_OTLP") delete childEnvironment[key];
    }
    async function run(command: string[], label: string, cwd = deployment.local.infra) {
      abort.signal.throwIfAborted();
      child = Bun.spawn(command, { cwd, env: childEnvironment, stdout: "pipe", stderr: "pipe" });
      const current = child;
      const escalation = () => { current.kill("SIGTERM"); setTimeout(() => { if (current.exitCode === null) current.kill("SIGKILL"); }, 5000).unref(); };
      abort.signal.addEventListener("abort", escalation, { once: true });
      try {
        await Promise.all([
          readLines(current.stdout as ReadableStream<Uint8Array>, line => logger.emit(line, "stdout", childEnvironment)),
          readLines(current.stderr as ReadableStream<Uint8Array>, line => logger.emit(line, "stderr", childEnvironment)),
        ]);
        if (await current.exited !== 0) throw new DeploymentError(`${label} failed. Inspect the collected deployment logs.`);
        abort.signal.throwIfAborted();
      } finally {
        if (current.exitCode === null) {
          escalation();
          await Promise.race([current.exited, Bun.sleep(5500)]);
        }
        abort.signal.removeEventListener("abort", escalation); child = undefined;
      }
    }
    logger.emit(`Preflight: ${deployment.identity}; Bun ${Bun.version}; Alchemy ${alchemyPackage.version}; Flarestack ${releaseVersion}.`);
    await logger.flush();
    await run(["dotnet", "--version"], ".NET SDK preflight");
    if (parsed.action !== "destroy") await run(["docker", "version", "--format", "Docker client {{.Client.Version}}; server {{.Server.Version}}"], "Docker preflight");
    const account = await resolveCloudAccount(abort.signal, line => logger.emit(line));
    const origin = deploymentOrigin(deployment.workerName, account.subdomain, deployment.settings.domain);
    logger.emit(`Cloudflare authentication verified. Target ${deployment.identity}: ${origin}`);
    if (!deployment.settings.email) logger.emit("Email is disabled for this environment: verification and password recovery are unavailable. Smoke checks do not certify those flows.");
    logger.emit("One container instance; ephemeral ASP.NET data-protection keys can require fresh sign-in after replacement. D1 users and application data persist.");
    if (parsed.action === "plan") logger.emit("Alchemy plan uses --dry-run for app resources; shared state bootstrap is subject to the same removal and replacement guard.");
    if (parsed.action !== "destroy") {
      await stageBuild(deployment.local.root, deployment.context, deployment.local.buildSources, deployment.local.dockerfile);
    }
    Object.assign(childEnvironment, {
      FLARESTACK_NON_DESTRUCTIVE_APPLY: parsed.action === "destroy" ? undefined : "1",
      ALCHEMY_TELEMETRY_DISABLED: "1", NO_COLOR: "1", FLARESTACK_DEPLOY: "1", FLARESTACK_LOCAL_MODE: "Container",
      FLARESTACK_DEPLOY_ENVIRONMENT: environment, FLARESTACK_CLOUD_BUILD_CONTEXT: deployment.context,
      PUBLIC_ORIGIN: origin, CLOUDFLARE_WORKERS_SUBDOMAIN: account.subdomain,
    });
    await logger.flush();
    await run([process.execPath, cli, parsed.action === "destroy" ? "destroy" : "deploy", "--config", "alchemy.run.ts", "--stage", environment, "--yes", ...(parsed.action === "plan" ? ["--dry-run"] : [])], `Cloud ${parsed.action}`);
    const statePath = resolve(deployment.local.root, ".alchemy", "deploy", deployment.identity, "deployment.json");
    if (parsed.action !== "plan") {
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({ stackName: deployment.stackName, environment, workerName: deployment.workerName, origin, release: releaseVersion, protocol: protocolVersion, status: parsed.action === "destroy" ? "destroyed" : "deployed", updatedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
    }
    if (parsed.action === "deploy") {
      logger.emit(`Deployed ${deployment.identity}: ${origin}; waiting for HTTPS/OIDC/health checks.`);
      let healthy = false;
      for (let attempt = 0; attempt < 24; attempt++) {
        abort.signal.throwIfAborted();
        try { await smokeDeployment(origin, abort.signal); healthy = true; break; }
        catch { if (attempt < 23) await Bun.sleep(2500); }
      }
      if (!healthy) throw new DeploymentError(`Deployment completed but its smoke check failed. Inspect ${origin} and the collected logs; resources were retained.`);
      await logger.flush();
      logger.emit(`Smoke checks completed: canonical HTTPS/OIDC discovery, health and private-route boundary. Application URL: ${origin}`);
    } else logger.emit(`${parsed.action} completed for ${deployment.identity}.`);
  } finally {
    if (child?.exitCode === null) child.kill("SIGTERM");
    try { await log?.close(); }
    finally {
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      abort.signal.removeEventListener("abort", kill);
    }
  }
}

if (import.meta.main) {
  try { await runDeployment(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof DeploymentError ? error.message : "Deployment failed or was cancelled. Inspect the collected logs; no automatic teardown was performed.");
    process.exitCode = 1;
  }
}
