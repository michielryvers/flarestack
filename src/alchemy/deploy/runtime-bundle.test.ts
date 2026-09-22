import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Alchemy's runtime flag prevents filesystem configuration evaluation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flarestack-runtime-config-"));
  try {
    const entry = join(directory, "auth.ts");
    await writeFile(entry, `import { loadAppEnvironment } from ${JSON.stringify(resolve(import.meta.dirname, "config.ts"))};
const app = globalThis.__ALCHEMY_RUNTIME__ ? undefined : loadAppEnvironment("/must-not-read/local.json", "test-client");
export const requireVerification = app?.email?.requireVerification ?? false;
`);
    const bundle = await Bun.build({ entrypoints: [entry], target: "bun", define: { "globalThis.__ALCHEMY_RUNTIME__": "true" }, minify: { syntax: true } });
    expect(bundle.success).toBe(true);
    const output = await bundle.outputs[0]!.text();
    expect(output.includes("must-not-read")).toBe(false);
    const runtime = join(directory, "runtime.mjs");
    await writeFile(runtime, output);
    expect((await import(runtime)).requireVerification).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
