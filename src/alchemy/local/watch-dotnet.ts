import { LocalLogs, readLines } from "./logs.ts";
import { stopProcess } from "./platform.ts";
if (!process.argv[2]) throw new Error("Usage: watch-dotnet.ts <project.csproj>");
const logs = new LocalLogs(process.env.OTEL_EXPORTER_OTLP_ENDPOINT!);
const child = Bun.spawn([process.env.FLARESTACK_DOTNET ?? "dotnet", "watch", "--non-interactive", "--project", process.argv[2], "run", "--no-launch-profile"], {
  stdout: "pipe", stderr: "pipe", env: { ...process.env, DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: "1", DOTNET_WATCH_RESTART_ON_RUDE_EDIT: "1" },
});
const readers = [readLines(child.stdout, line => { console.log(line); logs.emit("flarestack.watch", line); }), readLines(child.stderr, line => { console.error(line); logs.emit("flarestack.watch", line, "stderr"); })];
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void stopProcess(child); });
process.exitCode = await child.exited;
await Promise.all(readers);
await logs.shutdown();
