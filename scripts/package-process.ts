import { stopProcess } from "../src/alchemy/local/platform.ts";

async function exitedWithin(child: Bun.Subprocess, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Drain callers' pipes separately; keep the OTLP receiver alive until they flush. */
export async function stopPreparationProcess(child: Bun.Subprocess, graceMilliseconds = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // POSIX gets SIGINT first. Windows uses taskkill /T because killing only the
  // Aspire CLI wrapper leaves its dashboard descendant and inherited pipes alive.
  await stopProcess(child);
  if (await exitedWithin(child, graceMilliseconds)) return;
  await stopProcess(child, true);
  if (!await exitedWithin(child, 3000)) throw new Error("A package preparation process did not stop after forced termination.");
}
