import { LocalLogs, readLines } from "./logs.ts";
const logs = new LocalLogs(process.env.OTEL_EXPORTER_OTLP_ENDPOINT!);
const child = Bun.spawn([process.env.FLARESTACK_DOTNET ?? "dotnet", "watch", "--non-interactive", "--project", "samples/Todo/Todo.Web/Todo.Web.csproj", "run", "--no-launch-profile"], {
  stdout: "pipe", stderr: "pipe", env: { ...process.env, DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: "1", DOTNET_WATCH_RESTART_ON_RUDE_EDIT: "1" },
});
const readers = [readLines(child.stdout, line => { console.log(line); logs.emit("flarestack.watch", line); }), readLines(child.stderr, line => { console.error(line); logs.emit("flarestack.watch", line, "stderr"); })];
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill("SIGINT"));
process.exitCode = await child.exited;
await Promise.all(readers);
await logs.shutdown();
