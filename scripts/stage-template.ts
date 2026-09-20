import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const {version,protocol} = await Bun.file(resolve(root,"version.json")).json();
const output = resolve(root, "artifacts/template/content");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function transform(text: string) {
  return text.replaceAll("Todo.Web", "FlarestackTemplate.Web")
    .replaceAll("Todo.Client", "FlarestackTemplate.Client")
    .replaceAll("Todo.ServiceDefaults", "FlarestackTemplate.ServiceDefaults")
    .replaceAll("Flarestack.AppHost", "FlarestackTemplate.AppHost")
    .replaceAll("flarestack.todo", "flarestack.TemplateSlug")
    .replaceAll("todo-blazor", "TemplateSlug-blazor")
    .replaceAll("Flarestack Todo", "FlarestackTemplate");
}
async function emit(path: string, text: string) {
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}
async function copyTree(from: string, to: string) {
  for (const entry of await readdir(resolve(root, from), { withFileTypes: true })) {
    if (["bin", "obj", "node_modules", ".alchemy", ".packages", ".env", "local.machine.json"].includes(entry.name) || entry.name.startsWith(".env.")) continue;
    const source = `${from}/${entry.name}`, target = `${to}/${transform(entry.name)}`;
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) {
      if (entry.name.endsWith(".png")) { await mkdir(dirname(resolve(output, target)), { recursive: true }); await cp(resolve(root, source), resolve(output, target)); }
      else await emit(target, transform(await readFile(resolve(root, source), "utf8")));
    }
  }
}
for (const project of ["Todo.Web", "Todo.Client", "Todo.ServiceDefaults"]) await copyTree(`samples/Todo/${project}`, transform(project));
await copyTree("Flarestack.AppHost", "FlarestackTemplate.AppHost");
await copyTree("samples/Todo/migrations", "migrations");
for (const file of ["alchemy.run.ts", "auth.ts", "config.ts", "worker.ts", "email.ts"]) {
  let source = transform(await readFile(resolve(root, "samples/Todo/infra", file), "utf8"));
  if (file === "auth.ts") source = source.replace(/adminUserIds:\s*\[[^\]]*\]/g, "adminUserIds: []");
  await emit(`infra/${file}`, source);
}
for (const file of ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.Config", "mise.toml", "playwright.config.ts"])
  await emit(file, await readFile(resolve(root, file), "utf8"));
await emit("Dockerfile", transform(await readFile(resolve(root, "samples/Todo/Dockerfile"), "utf8")).replaceAll("samples/Todo/", ""));
const local = JSON.parse(await readFile(resolve(root, "samples/Todo/local.json"), "utf8"));
Object.assign(local, { stackName: "app-TemplateSlug", project: "FlarestackTemplate.Web/FlarestackTemplate.Web.csproj", buildRoot: ".", buildContext: ".alchemy/app-build", dockerfile: "Dockerfile",
  buildSources: ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.Config", "artifacts/nuget", "FlarestackTemplate.Web", "FlarestackTemplate.Client", "FlarestackTemplate.ServiceDefaults", "Dockerfile"] });
await emit("local.json", JSON.stringify(local, null, 2) + "\n");
await emit("deployment.json", await readFile(resolve(root,"samples/Todo/deployment.json"),"utf8"));
const host = transform(await readFile(resolve(root, "Flarestack.AppHost/AppHost.cs"), "utf8"))
  .replaceAll("../samples/Todo/infra", "../infra")
  .replaceAll("../samples/Todo/infra/node_modules", "../node_modules")
  .replace('.WithApplication("todo")', '.WithApplication("app")');
await emit("FlarestackTemplate.AppHost/AppHost.cs", host);
const hostSettings = JSON.parse(await readFile(resolve(root,"Flarestack.AppHost/appsettings.json"),"utf8"));
hostSettings.Flarestack.ApplicationName = "app";
await emit("FlarestackTemplate.AppHost/appsettings.json", JSON.stringify(hostSettings,null,2)+"\n");
await emit("aspire.config.json", JSON.stringify({ appHost: { path: "FlarestackTemplate.AppHost/FlarestackTemplate.AppHost.csproj" } }, null, 2));
await emit("FlarestackTemplate.slnx", '<Solution>\n  <Project Path="FlarestackTemplate.AppHost/FlarestackTemplate.AppHost.csproj" />\n  <Project Path="FlarestackTemplate.Web/FlarestackTemplate.Web.csproj" />\n  <Project Path="FlarestackTemplate.Client/FlarestackTemplate.Client.csproj" />\n  <Project Path="FlarestackTemplate.ServiceDefaults/FlarestackTemplate.ServiceDefaults.csproj" />\n</Solution>\n');
for (const file of ["todo.spec.ts", "accounts.ts", "local.ts", "accounts.spec.ts", "admin.spec.ts", "hot-reload.spec.ts", "verify-telemetry.ts"]) {
  const source = await readFile(resolve(root, "tests/e2e", file), "utf8");
  await emit(`tests/e2e/${file}`, transform(source)
    .replaceAll('"todo",', '"app",').replaceAll("workerd-flarestack-compatibility-", "workerd-app-TemplateSlug-")
    .replaceAll("samples/Todo/", "").replaceAll("(?:todo|flarestack\\.todo)", "(?:app|flarestack\\.TemplateSlug)"));
}
const infra = JSON.parse(await readFile(resolve(root, "samples/Todo/infra/package.json"), "utf8"));
const repo = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
infra.name = "app-TemplateSlug";
const infraManifest = { private: true, type: "module", flarestack: { configuration: "../local.json", release: version, protocol }, scripts: {
  "flarestack:deploy": "bun ../node_modules/@flarestack/alchemy/deploy/cli.ts ../local.json",
  "flarestack:dev": "bun ../node_modules/@flarestack/alchemy/local/dev.ts ../local.json",
  "flarestack:watch": "bun ../node_modules/@flarestack/alchemy/local/watch-dotnet.ts ../FlarestackTemplate.Web/FlarestackTemplate.Web.csproj"
}};
await emit("infra/package.json", JSON.stringify(infraManifest, null, 2) + "\n");
delete infra.flarestack;

const npmArchive = basename(infra.dependencies["@flarestack/alchemy"]);
infra.dependencies["@flarestack/alchemy"] = `file:artifacts/npm/${npmArchive}`;
infra.devDependencies = { "@playwright/test": repo.devDependencies["@playwright/test"], "typescript": repo.devDependencies.typescript };
const compiler = JSON.parse(await readFile(resolve(root,"tsconfig.json"),"utf8"));
compiler.include = ["infra/**/*.ts", "scripts/**/*.ts"];
await emit("tsconfig.json", JSON.stringify(compiler,null,2)+"\n");
infra.packageManager = repo.packageManager;
infra.patchedDependencies = repo.patchedDependencies;
for (const patch of Object.values(repo.patchedDependencies) as string[]) {
  await emit(patch, await readFile(resolve(root, patch), "utf8"));
}
await emit("scripts/local-mode.ts", await readFile(resolve(root,"scripts/local-mode.ts"),"utf8"));
await emit("scripts/smoke-cloud.ts", await readFile(resolve(root,"scripts/smoke-cloud.ts"),"utf8"));
infra.scripts = { "check": "tsc --noEmit", "destroy:cloud": "bun node_modules/@flarestack/alchemy/deploy/cli.ts local.json destroy", "smoke:cloud": "bun scripts/smoke-cloud.ts", "configure:local": "bun node_modules/@flarestack/alchemy/local/configure.ts local.json", doctor: "bun node_modules/@flarestack/alchemy/local/doctor.ts local.json", dev: "aspire run", "dev:container": "bun scripts/local-mode.ts container", "test:e2e": "playwright test", "test:e2e:container": "bun scripts/local-mode.ts e2e-container", "test:hot-reload": "bun scripts/local-mode.ts hot-reload", "verify:telemetry": "bun tests/e2e/verify-telemetry.ts" };
await emit("package.json", JSON.stringify(infra, null, 2) + "\n");
await emit(".gitignore", "**/bin/\n**/obj/\nnode_modules/\n**/local.machine.json\n.alchemy/\n.packages/\n.env\n.env.*\n*.user\ntest-results/\nplaywright-report/\n");
await emit("AGENTS.md", (await readFile(resolve(root, "AGENTS.md"), "utf8")).replaceAll("local Todo app", "local app"));
await cp(resolve(root, "templates/Flarestack.Templates/content"), output, { recursive: true });
for (const file of ["deployment.md", "infrastructure.md", "api-migration.md", "d1-configuration.md", "authentication-configuration.md", "aspire-hosting.md", "interactive-auto.md", "accounts-and-email.md", "public-api.md", "security-model.md", "database.md"]) await emit(`docs/${file}`, transform(await readFile(resolve(root, "docs", file), "utf8")).replaceAll("samples/Todo/", ""));
await emit("docs/adr/deployment-pipeline.md", await readFile(resolve(root,"docs/adr/deployment-pipeline.md"),"utf8"));
for (const name of ["Flarestack.D1", "Flarestack.Authentication", "Flarestack.Email", "Aspire.Hosting.Flarestack"]) {
  const file = `${name}.${version}.nupkg`;
  await mkdir(resolve(output, "artifacts/nuget"), { recursive: true });
  await cp(resolve(root, "artifacts/nuget", file), resolve(output, "artifacts/nuget", file));
}
await mkdir(resolve(output, "artifacts/npm"), { recursive: true });
await cp(resolve(root, "artifacts/npm", npmArchive), resolve(output, "artifacts/npm", npmArchive));
const lock = Bun.spawn(["bun", "install", "--lockfile-only"], { cwd: output, stdout: "inherit", stderr: "inherit" });
if (await lock.exited !== 0) throw new Error("Template lockfile resolution failed");
console.log("Staged standalone template with local packages.");
