import { mkdir, rm, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalLogs, readLines } from "../src/alchemy/local/logs.ts";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const running = Bun.spawn(["aspire", "describe", "--format", "Json", "--non-interactive"], { stdout: "pipe", stderr: "ignore" });
const snapshot = await new Response(running.stdout).text();
await running.exited;
if (snapshot.trim().startsWith("{")) throw new Error("Stop this AppHost with aspire stop before rebuilding its packages.");

// Bootstrap precedes the package-backed AppHost. Give its build/install processes
// their own temporary Aspire receiver rather than dropping their OTLP logs.
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4320";
const logs = new LocalLogs(endpoint);
let dashboard: Bun.Subprocess | undefined;
const children = new Set<Bun.Subprocess>();
const readers: Promise<void>[] = [];
let interrupted = false;
function interrupt() {
  interrupted = true;
  for (const child of children) if (child !== dashboard && child.exitCode === null) child.kill("SIGTERM");
}
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
function spawn(command: string[], cwd = root, service = "flarestack.packages") {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  children.add(child);
  readers.push(readLines(child.stdout, line => { console.log(line); logs.emit(service, line); }));
  readers.push(readLines(child.stderr, line => { console.error(line); logs.emit(service, line, "stderr"); }));
  return child;
}
async function run(command: string[], cwd = root) {
  if (interrupted) throw new Error("Package preparation interrupted");
  if (await spawn(command, cwd).exited !== 0) throw new Error(`Package preparation failed: ${command[0]} ${command[1]}`);
}
try {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    dashboard = spawn(["aspire", "dashboard", "run", "--non-interactive", "--allow-anonymous", "--frontend-url", "http://127.0.0.1:18889", "--otlp-http-url", endpoint, "--otlp-grpc-url", "http://127.0.0.1:4321"], root, "flarestack.package-dashboard");
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (interrupted) throw new Error("Package preparation interrupted");
      if (dashboard.exitCode !== null) throw new Error("Package dashboard exited during startup");
      try { ready = (await fetch("http://127.0.0.1:18889", { signal: AbortSignal.timeout(500) })).ok; } catch { /* Starting. */ }
      if (ready) break;
      await Bun.sleep(500);
    }
    if (!ready) throw new Error("Package dashboard did not become ready");
  }
  await mkdir("artifacts/nuget", { recursive: true });
  await mkdir("artifacts/npm", { recursive: true });
  await run(["bun", "run", "build:auth-ui"]);
  for (const name of ["Flarestack.D1", "Flarestack.Authentication", "Flarestack.Email", "Aspire.Hosting.Flarestack"]) {
    await run(["dotnet", "pack", `src/${name}/${name}.csproj`, "-c", "Release", "-o", "artifacts/nuget", "--nologo"]);
    // Only clear our local-preview packages in this repository's private cache.
    await rm(resolve(root, ".packages/nuget", name.toLowerCase(), "0.1.0-local.1"), { recursive: true, force: true });
  }
  await run(["bun", "pm", "pack", "--filename", resolve(root, "artifacts/npm/flarestack-alchemy-0.1.0-local.1.tgz"), "--ignore-scripts"], resolve(root, "src/alchemy"));
  // Bun's --no-cache skips manifest caches, but can still reuse a locked local
  // tarball. Give every distinct archive a distinct path to invalidate it reliably.
  const archive = resolve(root, "artifacts/npm/flarestack-alchemy-0.1.0-local.1.tgz");
  const digest = new Bun.CryptoHasher("sha256").update(await readFile(archive)).digest("hex").slice(0, 16);
  const filename = `flarestack-alchemy-0.1.0-local.1-${digest}.tgz`;
  await copyFile(archive, resolve(root, "artifacts/npm", filename));
  const sample = resolve(root, "samples/Todo/infra");
  const manifestPath = resolve(sample, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["@flarestack/alchemy"] = `file:../../../artifacts/npm/${filename}`;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await rm(resolve(sample, "node_modules/@flarestack/alchemy"), { recursive: true, force: true });
  await run(["bun", "install", "--force", "--no-cache"], sample);
  // Catch stale tarball/cache resolution before launching the app.
  for (const path of ["app.ts", "auth.ts", "worker.ts", "local/dev.ts", "local/watch-dotnet.ts"]) {
    if (!Buffer.from(await readFile(resolve(root, "src/alchemy", path))).equals(await readFile(resolve(sample, "node_modules/@flarestack/alchemy", path))))
      throw new Error(`Installed package does not match packed source: ${path}`);
  }
  await run(["dotnet", "restore", "Flarestack.slnx", "--force", "--no-cache", "--nologo"]);
  await run(["bun", "scripts/stage-template.ts"]);
  await run(["dotnet", "pack", "templates/Flarestack.Templates/Flarestack.Templates.csproj", "-o", "artifacts/templates", "--nologo"]);
  logs.emit("flarestack.packages", "Local packages and template ready");
  console.log("Local packages ready. Start the Todo AppHost with aspire run.");
} catch (error) {
  logs.emit("flarestack.packages", String(error), "stderr");
  process.exitCode = 1;
  console.error(error);
} finally {
  for (const child of children) if (child !== dashboard && child.exitCode === null) child.kill("SIGTERM");
  await logs.shutdown();
  dashboard?.kill("SIGINT");
  await Promise.race([Promise.all(readers), Bun.sleep(3000)]);
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
