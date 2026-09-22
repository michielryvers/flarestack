import { chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function entries(path: string) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** Existing simulator data needs its original database IDs before a local-state upgrade. */
export async function prepareLocalState(dotAlchemy: string, stack: string, stage: string) {
  const stateRoot = join(dotAlchemy, "state");
  const databaseFiles = await entries(join(dotAlchemy, "local", "d1", "cloudflare-runtime-D1DatabaseObject"));
  if (databaseFiles.some(file => file.isFile() && file.name.endsWith(".sqlite") && file.name !== "metadata.sqlite")) {
    const stateDirectory = join(stateRoot, stack, stage);
    let databaseMapped = false;
    for (const file of await entries(stateDirectory)) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const record = JSON.parse(await readFile(join(stateDirectory, file.name), "utf8")) as { resourceType?: string; attr?: { databaseId?: string } };
      if (record.resourceType === "Cloudflare.D1Database" && record.attr?.databaseId?.startsWith("dev:")) databaseMapped = true;
    }
    if (!databaseMapped) throw new Error("Existing local D1 data has no matching local Alchemy state. Migrate the original remote development state before starting; do not delete the local database or create replacement state.");
  }
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
}
