import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDeployment, deploymentEnvironment, deploymentIdentity, deploymentOrigin, parseDeploymentSettings } from "./config.ts";
import { assertDestroyConfirmation, includeBuildPath, parseArguments, redactOutput, safeBuildPath, stageBuild } from "./safety.ts";
import { loadLocalApp } from "../local/config.ts";
import { smokeDeployment } from "./smoke.ts";

test("requires exact named environment and configured production acknowledgement", () => {
  for (const value of [undefined, "", "Staging", "prod", "preview-random"]) expect(() => deploymentEnvironment(value)).toThrow();
  expect(deploymentEnvironment("staging")).toBe("staging");
  expect(() => parseDeploymentSettings({ environments: { production: {} } }, "production")).toThrow("allowEphemeralDataProtectionKeys");
  expect(parseDeploymentSettings({ environments: { production: { allowEphemeralDataProtectionKeys: true } } }, "production")).toEqual({ allowEphemeralDataProtectionKeys: true });
  expect(() => parseDeploymentSettings({ environments: { staging: { secret: "not-a-config-secret" } } }, "staging")).toThrow("Unknown deployment setting");
});
test("email is absent by default and configured explicitly", () => {
  expect(parseDeploymentSettings({ environments: { staging: {} } }, "staging").email).toBeUndefined();
  expect(parseDeploymentSettings({ environments: { staging: { email: { from: "sender@example.com", requireVerification: true } } } }, "staging").email?.requireVerification).toBe(true);
  expect(() => parseDeploymentSettings({ environments: { staging: { email: { from: "invalid" } } } }, "staging")).toThrow();
});
test.each(["https://app.example.com", "APP.example.com", "app.example.com/path", "edge.account.workers.dev"])("domain rejects noncanonical/custom settings %s", domain => {
  expect(() => parseDeploymentSettings({ environments: { staging: { domain } } }, "staging")).toThrow();
});
test("stable names isolate app and stage, including long names", () => {
  const stage = deploymentIdentity("task-board", "staging");
  expect(stage).toEqual({ stackName: "task-board", stage: "staging", identity: "task-board-staging", workerName: "task-board-staging-edge" });
  expect(deploymentIdentity("task-board", "production").workerName).not.toBe(stage.workerName);
  const name = "a".repeat(80);
  expect(deploymentIdentity(name, "staging").workerName).toHaveLength(54);
  expect(deploymentIdentity(name, "staging")).toEqual(deploymentIdentity(name, "staging"));
  expect(deploymentIdentity(name + "b", "staging").workerName).not.toBe(deploymentIdentity(name, "staging").workerName);
  expect(deploymentOrigin(stage.workerName, "account")).toBe("https://task-board-staging-edge.account.workers.dev");
  expect(deploymentOrigin(stage.workerName, "account", "app.example.com")).toBe("https://app.example.com");
});
test("CLI requires explicit action/environment and exact destruction identity", () => {
  expect(parseArguments(["../local.json", "deploy", "--environment", "staging"])).toMatchObject({ configuration: "../local.json", action: "deploy", environment: "staging" });
  expect(() => parseArguments(["../local.json", "destroy", "--yes"])).toThrow();
  expect(() => parseArguments(["../local.json", "deploy", "--environment", "staging", "--environment", "production"])).toThrow();
  expect(() => parseArguments(["../local.json", "deploy", "--confirm", "app-staging"])).toThrow();
  for (const confirmation of [undefined, "yes", "app-production", " app-staging "]) expect(() => assertDestroyConfirmation("app-staging", confirmation)).toThrow();
  expect(() => assertDestroyConfirmation("app-staging", "app-staging")).not.toThrow();
});
test.each(["../outside", "C:\\private", "\\\\server\\share", "/root", "app/../secret", "app\\..\\secret", ".alchemy/data"])("rejects escaping build path %s", path => {
  expect(safeBuildPath(path)).toBe(false);
});
test.each(["App/.env", "App/.env.production", "App\\.env.local", "App/bin/build.dll", "App\\obj\\generated.cs", "App/appsettings.Development.json", "App/local.machine.json", "App/private.pfx", "App/.git/config", "App/secrets.json", "App/node_modules/pkg"])("excludes sensitive/runtime paths %s", path => {
  expect(includeBuildPath(path)).toBe(false);
});
test("staging copies an arbitrary app allowlist while excluding secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "flarestack-deploy-build-"));
  try {
    await mkdir(join(root, "Notes.Web"));
    await writeFile(join(root, "Notes.Web", "Program.cs"), "public class App {}");
    await writeFile(join(root, "Notes.Web", ".env"), "secret");
    await writeFile(join(root, "Notes.Web", "appsettings.Development.json"), "secret");
    await writeFile(join(root, "Dockerfile"), "FROM scratch");
    const context = join(root, ".alchemy/deploy/notes-staging/build");
    await stageBuild(root, context, ["Notes.Web", "Dockerfile"], "Dockerfile");
    expect(await readFile(join(context, "Notes.Web/Program.cs"), "utf8")).toBe("public class App {}");
    expect(await Bun.file(join(context, "Notes.Web/.env")).exists()).toBe(false);
    expect(await Bun.file(join(context, "Notes.Web/appsettings.Development.json")).exists()).toBe(false);
    await expect(stageBuild(root, root, ["Notes.Web"], "Dockerfile")).rejects.toThrow();
    await symlink(join(root, "Notes.Web"), join(root, "linked"));
    await expect(stageBuild(root, context, ["linked", "Dockerfile"], "Dockerfile")).rejects.toThrow("symbolic links");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("redacts secrets before forwarding process logs", () => {
  const environment = { CLOUDFLARE_API_TOKEN: "private-token-value", OTEL_EXPORTER_OTLP_HEADERS: "x-key=private-header", PUBLIC_ORIGIN: "https://app.example.com" };
  const safe = redactOutput('request https://app.example.com/auth?code=private-code&state=private-state token private-token-value x-key=private-header', environment);
  for (const secret of ["private-code", "private-state", "private-token-value", "private-header"]) expect(safe).not.toContain(secret);
  expect(safe).toContain("https://app.example.com");
  expect(redactOutput('Authorization: Bearer unknown-profile-token', {})).not.toContain("unknown-profile-token");
  expect(redactOutput('Set-Cookie: session=private-cookie', {})).not.toContain("private-cookie");
});
test("smoke validates canonical issuer and private route boundary without auth secrets", async () => {
  const origin = "https://notes-staging-edge.account.workers.dev";
  const requests: string[] = [];
  const fake = (async (input: string | Request | URL) => {
    const url = String(input); requests.push(url);
    if (url.endsWith("openid-configuration")) return Response.json({ issuer: origin + "/auth", authorization_endpoint: origin + "/auth/authorize", token_endpoint: origin + "/auth/token", jwks_uri: origin + "/auth/jwks" });
    return new Response(null, { status: url.includes("/internal/") || url.endsWith("/d1") ? 404 : 200 });
  }) as typeof fetch;
  await smokeDeployment(origin, undefined, fake);
  expect(requests).toHaveLength(6);
  const wrong = (async () => Response.json({ issuer: "https://wrong.example/auth" })) as unknown as typeof fetch;
  await expect(smokeDeployment(origin, undefined, wrong)).rejects.toThrow("issuer");
});


test("deployment ignores invalid machine-only origin and port overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "flarestack-deploy-config-"));
  try {
    const configuration = join(root, "local.json");
    await writeFile(configuration, JSON.stringify({
      stackName: "notes", infrastructureDirectory: "infra", project: "Notes.Web",
      publicOrigin: "http://localhost:8080", bridgePort: 8800,
      buildRoot: ".", buildContext: ".alchemy/build", dockerfile: "Dockerfile",
      buildSources: ["Notes.Web", "Dockerfile"],
    }));
    await writeFile(join(root, "deployment.json"), JSON.stringify({ environments: { staging: {} } }));
    await writeFile(join(root, "local.machine.json"), JSON.stringify({ publicOrigin: "invalid", dashboardPort: -1 }));
    expect(loadDeployment(configuration, "staging").identity).toBe("notes-staging");
    expect(() => loadLocalApp(configuration)).toThrow();
    await writeFile(join(root, "local.machine.json"), "invalid json");
    expect(loadDeployment(configuration, "staging").local.publicOrigin).toBe("http://localhost:8080");
    expect(() => loadLocalApp(configuration)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
