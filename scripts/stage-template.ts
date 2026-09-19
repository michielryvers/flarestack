import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "artifacts/template/content");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function transform(text: string) {
  return text.replaceAll("Todo.Web", "FlarestackTemplate.Web")
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
    if (["bin", "obj", "node_modules", ".alchemy", ".packages", ".env"].includes(entry.name) || entry.name.startsWith(".env.")) continue;
    const source = `${from}/${entry.name}`, target = `${to}/${transform(entry.name)}`;
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) {
      if (entry.name.endsWith(".png")) { await mkdir(dirname(resolve(output, target)), { recursive: true }); await cp(resolve(root, source), resolve(output, target)); }
      else await emit(target, transform(await readFile(resolve(root, source), "utf8")));
    }
  }
}
for (const project of ["Todo.Web", "Todo.ServiceDefaults"]) await copyTree(`samples/Todo/${project}`, transform(project));
await copyTree("Flarestack.AppHost", "FlarestackTemplate.AppHost");
await copyTree("samples/Todo/migrations", "migrations");
for (const file of ["alchemy.run.ts", "auth.ts", "config.ts", "worker.ts"]) {
  await emit(`infra/${file}`, transform(await readFile(resolve(root, "samples/Todo/infra", file), "utf8")));
}
for (const file of ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.Config", "mise.toml", "playwright.config.ts"])
  await emit(file, await readFile(resolve(root, file), "utf8"));
await emit("Dockerfile", transform(await readFile(resolve(root, "samples/Todo/Dockerfile"), "utf8")).replaceAll("samples/Todo/", ""));
const local = JSON.parse(await readFile(resolve(root, "samples/Todo/local.json"), "utf8"));
Object.assign(local, { stackName: "app-TemplateSlug", project: "FlarestackTemplate.Web/FlarestackTemplate.Web.csproj", buildRoot: ".", buildContext: ".alchemy/app-build", dockerfile: "Dockerfile",
  buildSources: ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.Config", "artifacts/nuget", "FlarestackTemplate.Web", "FlarestackTemplate.ServiceDefaults", "Dockerfile"] });
await emit("local.json", JSON.stringify(local, null, 2) + "\n");
const host = transform(await readFile(resolve(root, "Flarestack.AppHost/AppHost.cs"), "utf8"))
  .replaceAll("../samples/Todo/local.json", "../local.json")
  .replaceAll("../samples/Todo/infra/node_modules", "../node_modules")
  .replace('ApplicationName = "todo"', 'ApplicationName = "app"');
await emit("FlarestackTemplate.AppHost/AppHost.cs", host);
await emit("aspire.config.json", JSON.stringify({ appHost: { path: "FlarestackTemplate.AppHost/FlarestackTemplate.AppHost.csproj" } }, null, 2));
await emit("FlarestackTemplate.slnx", '<Solution>\n  <Project Path="FlarestackTemplate.AppHost/FlarestackTemplate.AppHost.csproj" />\n  <Project Path="FlarestackTemplate.Web/FlarestackTemplate.Web.csproj" />\n  <Project Path="FlarestackTemplate.ServiceDefaults/FlarestackTemplate.ServiceDefaults.csproj" />\n</Solution>\n');
for (const file of ["todo.spec.ts", "hot-reload.spec.ts", "verify-telemetry.ts"]) {
  const source = await readFile(resolve(root, "tests/e2e", file), "utf8");
  await emit(`tests/e2e/${file}`, transform(source)
    .replaceAll('"todo",', '"app",').replaceAll("workerd-flarestack-compatibility-", "workerd-app-TemplateSlug-")
    .replaceAll("samples/Todo/", "").replaceAll("(?:todo|flarestack\\.todo)", "(?:app|flarestack\\.TemplateSlug)"));
}
const infra = JSON.parse(await readFile(resolve(root, "samples/Todo/infra/package.json"), "utf8"));
const repo = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
infra.name = "app-TemplateSlug";
const npmArchive = basename(infra.dependencies["@flarestack/alchemy"]);
infra.dependencies["@flarestack/alchemy"] = `file:artifacts/npm/${npmArchive}`;
infra.devDependencies = { "@playwright/test": repo.devDependencies["@playwright/test"] };
infra.packageManager = repo.packageManager;
infra.patchedDependencies = repo.patchedDependencies;
for (const patch of Object.values(repo.patchedDependencies) as string[]) {
  await emit(patch, await readFile(resolve(root, patch), "utf8"));
}
infra.scripts = { dev: "aspire run", "dev:container": "Flarestack__LocalMode=Container aspire run", "test:e2e": "playwright test", "test:e2e:container": "FLARESTACK_TEST_MODE=Container playwright test todo.spec.ts", "test:hot-reload": "FLARESTACK_TEST_HOT_RELOAD=1 playwright test hot-reload", "verify:telemetry": "bun tests/e2e/verify-telemetry.ts" };
await emit("package.json", JSON.stringify(infra, null, 2) + "\n");
await emit(".gitignore", "**/bin/\n**/obj/\nnode_modules/\n.alchemy/\n.packages/\n.env\n.env.*\n*.user\ntest-results/\nplaywright-report/\n");
await emit("AGENTS.md", (await readFile(resolve(root, "AGENTS.md"), "utf8")).replaceAll("local Todo app", "local app"));
await cp(resolve(root, "templates/Flarestack.Templates/content"), output, { recursive: true });
for (const name of ["Flarestack.D1", "Flarestack.Authentication", "Aspire.Hosting.Flarestack"]) {
  const file = `${name}.0.1.0-local.1.nupkg`;
  await mkdir(resolve(output, "artifacts/nuget"), { recursive: true });
  await cp(resolve(root, "artifacts/nuget", file), resolve(output, "artifacts/nuget", file));
}
await mkdir(resolve(output, "artifacts/npm"), { recursive: true });
await cp(resolve(root, "artifacts/npm", npmArchive), resolve(output, "artifacts/npm", npmArchive));
const lock = Bun.spawn(["bun", "install", "--lockfile-only"], { cwd: output, stdout: "inherit", stderr: "inherit" });
if (await lock.exited !== 0) throw new Error("Template lockfile resolution failed");
console.log("Staged standalone template with local packages.");
