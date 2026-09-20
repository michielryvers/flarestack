// Repository convenience wrapper. Generated apps invoke the same packaged runner.
import { resolve } from "node:path";
const infrastructure = resolve(import.meta.dirname, "../samples/Todo/infra");
const command = Bun.spawn([
  "bun", "node_modules/@flarestack/alchemy/deploy/cli.ts", "../local.json", ...process.argv.slice(2),
], { cwd: infrastructure, env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exitCode = await command.exited;
