import { createServer } from "node:net";
import { LocalLogs, readLines } from "../local/logs.ts";
import { DeploymentError } from "./config.ts";
import { redactOutput } from "./safety.ts";
import { stopProcessTree } from "../local/platform.ts";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export async function deploymentLogs(signal: AbortSignal, onReceiverFailure?: () => void, settings: { environment?: "staging" | "production" } = {}) {
  const external = process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT;
  let dashboard: Bun.Subprocess | undefined;
  let readers: Promise<void>[] = [];
  let closing = false;
  const port = external ? undefined : await freePort();
  const endpoint = external ?? `http://127.0.0.1:${port}`;
  const parsed = new URL(endpoint);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new DeploymentError("Deployment OTLP endpoint must be an HTTP(S) URL without credentials or query parameters.");
  let exportFailed = false;
  const logs = new LocalLogs(endpoint, { environment: settings.environment, onExportFailure: () => { exportFailed = true; } });
  const assertExported = () => {
    if (exportFailed) throw new DeploymentError("Deployment log export failed. Check the OTLP receiver and credentials; any applied resources were retained.");
  };
  const flush = async () => {
    try { await logs.flush(); } catch { exportFailed = true; }
    assertExported();
  };
  const emit = (line: string, stream = "stdout", environment: Record<string, string | undefined> = process.env) => {
    const safe = redactOutput(line, environment);
    (stream === "stderr" ? console.error : console.log)(safe);
    logs.emit("flarestack.deploy", safe, stream);
  };
  try {
    if (!external) {
      const ports = new Set([port]);
      while (ports.size < 3) ports.add(await freePort());
      const [, frontendPort, grpcPort] = [...ports];
      const frontend = `http://127.0.0.1:${frontendPort}`;
      dashboard = Bun.spawn(["aspire", "dashboard", "run", "--non-interactive", "--allow-anonymous", "--frontend-url", frontend, "--otlp-http-url", endpoint, "--otlp-grpc-url", `http://127.0.0.1:${grpcPort}`], { stdout: "pipe", stderr: "pipe" });
      void dashboard.exited.then(() => { if (!closing) onReceiverFailure?.(); });
      const initial: Array<[string, string]> = [];
      let ready = false;
      readers = [[dashboard.stdout, "stdout"], [dashboard.stderr, "stderr"]].map(([stream, name]) => readLines(stream as ReadableStream<Uint8Array>, line => {
        if (closing) return;
        if (ready) emit(line, name as string);
        else if (initial.length < 500) initial.push([line, name as string]);
      }));
      for (let attempt = 0; attempt < 60; attempt++) {
        signal.throwIfAborted();
        if (dashboard.exitCode !== null) throw new DeploymentError("The temporary Aspire deployment receiver failed to start.");
        try { ready = (await fetch(frontend, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Dashboard starting. */ }
        if (ready) break;
        await Bun.sleep(500);
      }
      if (!ready) throw new DeploymentError("The temporary Aspire deployment receiver did not become ready.");
      for (const [line, stream] of initial) emit(line, stream);
      emit(`Deployment logs → ${frontend}`);
    }
    return { endpoint, emit, flush, async close() {
      closing = true;
      try { await logs.shutdown(); } catch { exportFailed = true; }
      finally {
        if (dashboard) await stopProcessTree(dashboard);
        await Promise.race([Promise.all(readers), Bun.sleep(3000)]);
      }
      assertExported();
    } };
  } catch (error) {
    closing = true;
    try { await logs.shutdown(); }
    finally { if (dashboard) await stopProcessTree(dashboard); }
    throw error;
  }
}
