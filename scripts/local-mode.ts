/** Launch optional local workflows without shell-specific environment assignments. */
export function localCommand(mode: string | undefined, extra: string[] = []) {
  switch (mode) {
    case "container": return { args: ["aspire", extra.includes("--background") ? "start" : "run", ...extra.filter(arg => arg !== "--background" && arg !== "--")], env: { Flarestack__LocalMode: "Container" } };
    case "e2e-container": return { args: ["bunx", "playwright", "test", ...extra.filter(arg => arg !== "--")], env: { FLARESTACK_TEST_MODE: "Container" } };
    case "hot-reload": return { args: ["bunx", "playwright", "test", "hot-reload", ...extra.filter(arg => arg !== "--")], env: { FLARESTACK_TEST_HOT_RELOAD: "1" } };
    default: throw new Error("Usage: local-mode.ts [container|e2e-container|hot-reload]");
  }
}

if (import.meta.main) {
  const command = localCommand(process.argv[2], process.argv.slice(3));
  const child = Bun.spawn(command.args, {
    env: { ...process.env, ...command.env }, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  process.exitCode = await child.exited;
}
