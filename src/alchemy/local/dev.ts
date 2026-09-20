import { readdir, stat, open, cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { alchemyEnvironment, pathParts, relayHost, stopProcess, workerLogService } from "./platform.ts";
import { relayHandler } from "./relay.ts";
import { LocalLogs, readLines } from "./logs.ts";

import { protocolVersion, releaseVersion } from "../protocol.ts";
import { startInbox } from "./inbox.ts";
import { loadLocalApp } from "./config.ts";

if (!process.argv[2]) throw new Error("Usage: dev.ts <local-app.json>");
const app = loadLocalApp(process.argv[2]);
const infra = app.infra;
const contract = (await Bun.file(resolve(infra,"package.json")).json()).flarestack;
if (contract?.protocol !== protocolVersion || contract?.release !== releaseVersion) throw new Error(`@flarestack/alchemy ${releaseVersion} expects infrastructure protocol ${protocolVersion} and the same release. Upgrade the complete package set.`);
const logRoot = resolve(infra, ".alchemy/log");
const started = new Date().toISOString();
const dashboardUrl = "http://127.0.0.1:18888";
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318";
const fast = process.env.FLARESTACK_LOCAL_MODE === "Fast";
const relayToken = fast ? "" : randomBytes(32).toString("hex");
const external = process.env.FLARESTACK_EXTERNAL_OTLP === "1";
if (!external && endpoint !== "http://127.0.0.1:4318") throw new Error("Set FLARESTACK_EXTERNAL_OTLP=1 to use an existing collector");
const logs = new LocalLogs(endpoint);
const children = new Set<Bun.Subprocess>();
const readers: Promise<unknown>[] = [];
let stopping = false;
let wakeStop: () => void;
const stopped = new Promise<void>(resolve => { wakeStop = resolve; });
function stop() { stopping = true; inbox?.stop(); relay?.stop(); wakeStop(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function spawn(command: string[], service: string, cwd = infra, echo = true) {
  const child = Bun.spawn(command, {
    cwd, stdout: "pipe", stderr: "pipe",
    env: { ...(service === "flarestack.alchemy" ? alchemyEnvironment(app.root, process.env) : process.env), PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? app.publicOrigin, ALCHEMY_TELEMETRY_DISABLED: "1", NO_COLOR: "1", FLARESTACK_LOCAL_OTLP_HEADERS: relayToken ? `x-flarestack-relay=${relayToken}` : "" },
  });
  children.add(child);
  for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) {
    readers.push(readLines(stream, line => {
      if (echo) (name === "stdout" ? console.log : console.error)(line);
      // Worker files are the authoritative source; avoid replaying their CLI mirror.
      if (service !== "flarestack.alchemy" || !/^\[(Edge|Auth|LocalBridge|Email)\]/.test(line)) logs.emit(service, line, name);
    }).catch(error => { if (!stopping) console.error(`Log reader failed: ${error.message}`); }));
  }
  return child;
}

// Remember byte offsets so previous sessions are never replayed into this dashboard.
const files = new Map<string, { offset: number; pending: string; decoder: TextDecoder }>();
async function workerFiles(directory = logRoot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []; throw error;
  });
  const nested = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return workerFiles(path);
    return entry.isFile() && workerLogService(path) !== undefined ? [path] : [];
  }));
  return nested.flat();
}
async function scanFiles(initial = false) {
  for (const path of await workerFiles()) {
    try {
    const size = (await stat(path)).size;
    const state = files.get(path) ?? { offset: initial ? size : 0, pending: "", decoder: new TextDecoder() };
    if (size < state.offset) { state.offset = 0; state.pending = ""; state.decoder = new TextDecoder(); }
    if (size > state.offset) {
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(Math.min(size - state.offset, 65536));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
        state.offset += bytesRead;
        state.pending += state.decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
        const lines = state.pending.split("\n");
        state.pending = lines.pop() ?? "";
        const service = workerLogService(path)!;
        for (const line of lines) logs.emit(service, line, "stdout", { "log.file.path": relative(infra, path) });
        if (state.pending.length > 65536) { logs.emit(service, state.pending.slice(0, 65536)); state.pending = ""; }
      } finally { await handle.close(); }
    }
    files.set(path, state);
    } catch (error) {
      // Alchemy may rotate a file after enumeration or before open().
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.delete(path);
    }
  }
}
const attached = new Set<string>();
function attachContainer(line: string) {
  const [id, name] = line.split(" ");
  if (!id || !name?.startsWith(`workerd-${app.stackName}-`) || attached.has(id) || stopping) return;
  attached.add(id);
  spawn(["docker", "logs", "--follow", "--since", started, id], name.endsWith("-proxy") ? "flarestack.container-proxy" : "flarestack.dotnet", infra, false);
}
function watchContainers() {
  // Start events capture failures too brief for periodic discovery.
  const events = Bun.spawn(["docker", "events", "--filter", "event=start", "--format", "{{.Actor.ID}} {{.Actor.Attributes.name}}"], {stdout:"pipe",stderr:"pipe"});
  children.add(events);
  readers.push(readLines(events.stdout, attachContainer));
  readers.push(readLines(events.stderr, line => logs.emit("flarestack.local", line, "stderr")));
}
async function scanContainers() {
  const process = Bun.spawn(["docker", "ps", "--no-trunc", "--filter", `name=^workerd-${app.stackName}-`, "--format", "{{.ID}} {{.Names}}"], { stdout: "pipe", stderr: "pipe" });
  const [output, error, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exit) throw new Error(`Docker log discovery failed: ${error.trim()}`);
  for (const line of output.trim().split("\n")) attachContainer(line);
}

// The relay requires a per-run credential even when a Docker host interface is used.
const relay = fast ? undefined : Bun.serve({
  hostname: relayHost(), port: app.relayPort!, maxRequestBodySize: 4 * 1024 * 1024,
  fetch: relayHandler(endpoint, relayToken, process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ""),
});
let exitCode = 0;
let dashboard: Bun.Subprocess | undefined;
let inbox: ReturnType<typeof startInbox> | undefined;
try {
  await scanFiles(true);
  if (!external) {
    // Anonymous endpoints are deliberately bound to loopback only.
    dashboard = spawn(["aspire", "dashboard", "run", "--non-interactive", "--allow-anonymous", "--frontend-url", dashboardUrl, "--otlp-http-url", endpoint, "--otlp-grpc-url", "http://127.0.0.1:4317"], "flarestack.dashboard");
    void dashboard.exited.then(() => { if (!stopping) { console.error("Aspire dashboard exited; stopping local services"); exitCode = 1; stop(); } });
    let ready = false;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      if (dashboard.exitCode !== null) throw new Error("Aspire dashboard exited during startup; check port conflicts");
      try { ready = (await fetch(dashboardUrl, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Starting. */ }
      if (ready) break;
      await Bun.sleep(500);
    }
    if (!ready) throw new Error("Aspire dashboard did not become ready");
  }
  inbox = startInbox(infra, app.inboxPort!, logs);
  logs.emit("flarestack.local", JSON.stringify({ message: "Local OTLP log collection started", endpoint }));
  console.log(`Local logs → ${endpoint}; Aspire dashboard → ${dashboardUrl}`);
  const root = app.root;
  if (app.beforeStart) {
    const build = spawn(app.beforeStart, "flarestack.build", root);
    if (await build.exited !== 0) throw new Error("Application preparation command failed");
  }
  const buildContext = app.context;
  await rm(buildContext, { recursive: true, force: true });
  await mkdir(buildContext, { recursive: true });
  for (const source of app.buildSources) {
    await cp(resolve(root, source), resolve(buildContext, source), { recursive: true, filter: path => !pathParts(path).some(part => ["bin", "obj", ".alchemy", "node_modules"].includes(part)) });
  }
  // The public OIDC issuer is an identity, not an outbound connection URL.
  // Alchemy rewrites loopback URLs in Docker env, so stage it as app configuration.
  const settingsPath = resolve(buildContext, relative(root, dirname(app.projectPath)), "appsettings.Development.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"; throw error;
  }));
  settings.Flarestack ??= {}; settings.Flarestack.Authentication ??= {};
  settings.Flarestack.Authentication.Authority = `${process.env.PUBLIC_ORIGIN ?? app.publicOrigin}/auth`;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  if (!fast) watchContainers();
  const alchemyCli = fileURLToPath(new URL("../bin/cli.js", import.meta.resolve("alchemy")));
  const alchemy = spawn(["bun", "run", alchemyCli, "dev", "--no-input"], "flarestack.alchemy");
  void alchemy.exited.then(code => { if (!stopping) { exitCode = code; stop(); } });
  let iteration = 0;
  while (!stopping) {
    await scanFiles();
    if (!fast && iteration++ % 4 === 0) await scanContainers();
    await Promise.race([Bun.sleep(500), stopped]);
  }
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  stopping = true;
  // Stop producers first, collect their final lines, then flush OTLP before dashboard teardown.
  const producers = [...children].filter(child => child !== dashboard);
  await Promise.all(producers.map(child => stopProcess(child)));
  await Promise.race([Promise.all(producers.map(child => child.exited)), Bun.sleep(5000)]);
  await Promise.all(producers.map(child => stopProcess(child, true)));
  await scanFiles().catch(() => {});
  await logs.shutdown();
  relay?.stop();
  inbox?.stop();
  if (dashboard) await stopProcess(dashboard);
  await Promise.race([Promise.all(readers), Bun.sleep(2000)]);
}
process.exitCode = exitCode;
