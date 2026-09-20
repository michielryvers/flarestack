import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { posix, win32 } from "node:path";

/** Keep Alchemy's cross-process Worker registry inside this application. */
export function alchemyEnvironment(root: string, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const path = platform === "win32" ? win32 : posix;
  return { ...environment, XDG_STATE_HOME: path.join(root, ".alchemy", "runtime-state") };
}

/** Normalize native paths only for comparisons; keep original paths for file I/O. */
export function pathParts(path: string): string[] {
  return path.split(/[\\/]/);
}

export function workerLogService(path: string): string | undefined {
  const parts = pathParts(path);
  if (!parts.at(-1)?.endsWith(".log")) return undefined;
  const worker = parts.at(-2);
  if (worker === "Email") return "flarestack.email";
  if (worker === "Auth") return "flarestack.auth";
  if (worker === "Edge" || worker === "LocalBridge") return "flarestack.worker";
  return undefined;
}

/** Linux Docker uses a bridge gateway; Docker Desktop exposes the host through its VM. */
export function relayHost(
  override = process.env.FLARESTACK_RELAY_HOST,
  platform: NodeJS.Platform = process.platform,
  interfaces = networkInterfaces(),
): string {
  if (override) {
    if (!isIP(override)) throw new Error("FLARESTACK_RELAY_HOST must be a local IP address.");
    return override;
  }
  if (platform === "linux") {
    const bridge = interfaces.docker0?.find(address => address.family === "IPv4");
    if (bridge) return bridge.address;
  }
  return "0.0.0.0";
}

/** Bun maps Windows termination to TerminateProcess; taskkill also closes watch descendants. */
export function terminationCommand(pid: number, platform: NodeJS.Platform = process.platform): string[] | undefined {
  return platform === "win32" ? ["taskkill", "/PID", String(pid), "/T", "/F"] : undefined;
}

export async function stopProcess(child: Bun.Subprocess, force = false): Promise<void> {
  if (child.exitCode !== null) return;
  const command = terminationCommand(child.pid);
  if (command) {
    const killer = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    if (await killer.exited !== 0 && child.exitCode === null) child.kill();
  } else {
    child.kill(force ? "SIGKILL" : "SIGINT");
  }
}
