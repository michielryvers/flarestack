import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareLocalState } from "./state.ts";

test("local state rejects legacy D1 without the selected stack and stage mapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "flarestack-state-"));
  try {
    await prepareLocalState(root, "app", "dev_test");
    if (process.platform !== "win32") expect((await stat(join(root, "state"))).mode & 0o777).toBe(0o700);
    const d1 = join(root, "local/d1/cloudflare-runtime-D1DatabaseObject");
    await mkdir(d1, { recursive: true });
    await writeFile(join(d1, "metadata.sqlite"), "");
    await prepareLocalState(root, "app", "dev_test");
    await writeFile(join(d1, "existing.sqlite"), "retained test data");
    await expect(prepareLocalState(root, "app", "dev_test")).rejects.toThrow("Migrate the original");
    const stage = join(root, "state/app/dev_test");
    await mkdir(stage, { recursive: true });
    await writeFile(join(stage, "Database.json"), JSON.stringify({ resourceType: "Cloudflare.D1Database", attr: { databaseId: "dev:retained-id" } }));
    await prepareLocalState(root, "app", "dev_test");
    await expect(prepareLocalState(root, "other-app", "dev_test")).rejects.toThrow("Migrate the original");
    await expect(prepareLocalState(root, "app", "other-stage")).rejects.toThrow("Migrate the original");
  } finally { await rm(root, { recursive: true, force: true }); }
});
