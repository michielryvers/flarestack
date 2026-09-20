import { expect, test } from "bun:test";
import { stopPreparationProcess } from "./package-process.ts";

async function fixture(ignoreInterrupt: boolean) {
  const code = `process.on("SIGINT", () => { ${ignoreInterrupt ? "" : 'console.log("flushed before exit"); process.exit(7);'} }); console.log("ready"); setInterval(() => {}, 1000);`;
  const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
  } finally { reader.releaseLock(); }
  return child;
}

test("package cleanup waits for graceful process exit and final pipe output", async () => {
  const child = await fixture(false);
  try {
    await stopPreparationProcess(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    const chunks: string[] = [];
    for await (const chunk of child.stdout) chunks.push(new TextDecoder().decode(chunk));
    const output = chunks.join("");
    if (process.platform !== "win32") {
      expect(child.exitCode).toBe(7);
      expect(output).toContain("flushed before exit");
    }
    await stopPreparationProcess(child);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

test("package cleanup escalates an unresponsive process and closes its pipes", async () => {
  const child = await fixture(true);
  try {
    await stopPreparationProcess(child, 50);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    expect(chunks).toHaveLength(0);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

test("dashboard-style wrapper cleanup closes descendant-held output pipes", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    const descendant = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "inherit", stderr: "inherit" });
    process.on("SIGINT", async () => { descendant.kill("SIGTERM"); await descendant.exited; process.exit(0); });
    console.log(descendant.pid);
    setInterval(() => {}, 1000);
  `], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  let descendantPid: number | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    descendantPid = Number(new TextDecoder().decode((await reader.read()).value).trim());
    expect(descendantPid).toBeGreaterThan(0);
    await stopPreparationProcess(child);
    // The descendant inherits this pipe. EOF proves that stopping the wrapper
    // did not leave its descendant keeping CI's output handle alive.
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Descendant kept output pipe open")), 2000); }),
    ]);
    expect(result.done).toBe(true);
  } finally {
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (descendantPid) {
      try { process.kill(descendantPid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  }
});
