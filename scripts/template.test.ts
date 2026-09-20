import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const {version} = await Bun.file(resolve(root,"version.json")).json();
const archive = resolve(root, `artifacts/templates/Flarestack.Templates.${version}.nupkg`);
const cliHome = await mkdtemp(join(tmpdir(), "flarestack-template-home-"));
const environment = { ...process.env, DOTNET_CLI_HOME: cliHome };
afterAll(() => rm(cliHome, { recursive: true, force: true }));
async function dotnet(args: string[]) {
  const command = Bun.spawn(["dotnet", ...args], { cwd: root, env: environment, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited]);
  expect(code, stdout + stderr).toBe(0);
}
beforeAll(async () => {
  // Isolated CLI home leaves the developer's template registrations unchanged.
  await dotnet(["new", "install", archive]);
}, 30_000);

const secretIds = new Set<string>();
test.each([
  ["MyApp", "MyApp", "myapp"],
  ["Acme.Notes-App", "Acme.Notes_App", "acme-notes-app"],
])("generates standalone app %s with consistent names and unchanged packages", async (name, project, slug) => {
  const directory = await mkdtemp(join(tmpdir(), "flarestack-template-test-"));
  try {
    await dotnet(["new", "flarestack-blazor", "-n", name, "-o", directory]);
    const local = await Bun.file(join(directory, "local.json")).json();
    expect(local.stackName).toBe(`app-${slug}`);
    expect(local.project).toBe(`${project}.Web/${project}.Web.csproj`);
    expect(await Bun.file(join(directory, local.project)).exists()).toBe(true);
    expect(await Bun.file(join(directory, `${project}.Client/${project}.Client.csproj`)).exists()).toBe(true);
    expect(await readFile(join(directory, `${project}.Client/Pages/Todos.razor`), "utf8")).toContain("@rendermode InteractiveAuto");
    for (const path of local.buildSources) expect((await readdir(directory)).includes(path.split("/")[0])).toBe(true);
    const host = await readFile(join(directory, `${project}.AppHost/${project}.AppHost.csproj`), "utf8");
    const hostCode = await readFile(join(directory, `${project}.AppHost/AppHost.cs`), "utf8");
    expect(hostCode).toContain('AddFlarestack("cloudflare", "../infra")');
    expect((await Bun.file(join(directory, `${project}.AppHost/appsettings.json`)).json()).Flarestack.ApplicationName).toBe("app");
    expect(hostCode).not.toContain("FlarestackLocal.Configure");
    const secretId = host.match(/<UserSecretsId>(.*?)<\/UserSecretsId>/)![1]!;
    expect(secretId).not.toBe("1709b865-a1ba-4d20-8b74-0482bc3feb4c");
    expect(secretIds.has(secretId)).toBe(false);
    secretIds.add(secretId);
    const code = await readFile(join(directory, `${project}.Web/Program.cs`), "utf8");
    expect(code).toContain(`using ${project}.Web;`);
    const config = await Bun.file(join(directory, "aspire.config.json")).json();
    expect(await Bun.file(join(directory, config.appHost.path)).exists()).toBe(true);
    const manifest = await Bun.file(join(directory, "package.json")).json();
    expect(manifest.name).toBe(`app-${slug}`);
    expect(manifest.scripts["migrate:local-state"]).toBe("bun node_modules/@flarestack/alchemy/local/migrate-state.ts local.json");
    expect(manifest.scripts["dev:container"]).toBe("bun scripts/local-mode.ts container");
    const infraManifest = await Bun.file(join(directory, "infra/package.json")).json();
    expect(infraManifest.scripts["flarestack:deploy"]).toBe("bun ../node_modules/@flarestack/alchemy/deploy/cli.ts ../local.json");
    expect(await Bun.file(join(directory, "deployment.json")).json()).toEqual({ environments: { staging: {}, production: {} } });
    expect(await Bun.file(join(directory, "docs/cloud-preview.md")).exists()).toBe(false);
    const readme = await readFile(join(directory, "README.md"), "utf8");
    expect(readme).toContain("aspire deploy --environment staging");
    expect(readme).not.toContain("/usr/bin/chromium");
    expect(readme).not.toContain("172.17.0.1");
    expect(await readFile(join(directory, "infra/auth.ts"), "utf8")).not.toContain("adminUserIds:");
    expect(await Bun.file(join(directory, "docs/accounts-and-email.md")).exists()).toBe(true);
    for (const patch of Object.values(manifest.patchedDependencies) as string[])
      expect(await readFile(join(directory, patch))).toEqual(await readFile(join(root, patch)));
    for (const path of [manifest.dependencies["@flarestack/alchemy"].replace("file:artifacts/", ""), `nuget/Flarestack.D1.${version}.nupkg`, `nuget/Flarestack.Email.${version}.nupkg`, `nuget/Flarestack.Authentication.${version}.nupkg`, `nuget/Aspire.Hosting.Flarestack.${version}.nupkg`])
      expect(await readFile(join(directory, "artifacts", path))).toEqual(await readFile(join(root, "artifacts", path)));
    expect(await readdir(join(directory, "infra"))).not.toContain(".alchemy");
    expect(await readdir(directory)).not.toContain(".template.config");
    expect(await readFile(join(directory, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(await readFile(join(directory, "Dockerfile"), "utf8")).toContain(`dotnet publish ${project}.Web/${project}.Web.csproj`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
