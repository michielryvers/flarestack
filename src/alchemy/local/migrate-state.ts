import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { credentialsFilePath } from "alchemy/Auth/Credentials";
import { loadLocalApp } from "./config.ts";
import { LocalLogs } from "./logs.ts";

type JsonObject = Record<string, unknown>;
export class MigrationError extends Error {}
export interface MigrationOptions {
  infrastructureDirectory: string;
  stack: string;
  stage: string;
  accountId: string;
  databaseId: string;
  credentials: { url: string; authToken: string; accountId?: string };
  apply?: boolean;
}
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const segment = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);
function filename(fqn: string) {
  if (!fqn.split("/").every(segment)) throw new MigrationError("Unsupported resource identity in legacy state.");
  return fqn.replaceAll("/", "__") + ".json";
}
async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new MigrationError("Local state path must contain real directories.");
  await chmod(path, 0o700);
}

/** Read only the selected legacy stage. Raw encoded values never enter logs. */
export async function migrateLegacyState(options: MigrationOptions, request: typeof fetch = fetch) {
  if (!segment(options.stack) || !/^dev_[a-zA-Z0-9_-]+$/.test(options.stage)) throw new MigrationError("Migration requires an explicit legacy dev_<user> stage and stack name.");
  if (!options.accountId || options.credentials.accountId !== options.accountId) throw new MigrationError("Cached state credentials do not match the expected account.");
  if (!options.databaseId.startsWith("dev:")) throw new MigrationError("Migration requires the existing local dev: database ID.");
  const endpoint = new URL(options.credentials.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" || !options.credentials.authToken) throw new MigrationError("Cached state endpoint is invalid.");
  const base = `/state/stacks/${encodeURIComponent(options.stack)}/stages/${encodeURIComponent(options.stage)}`;
  async function get(path: string): Promise<unknown> {
    try {
      const response = await request(new URL(path, endpoint), { method: "GET", headers: { authorization: `Bearer ${options.credentials.authToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new MigrationError("Legacy state read failed; no cloud resources were changed.");
      if (response.status === 204) return undefined;
      return await response.json();
    } catch { throw new MigrationError("Legacy state read failed; verify the existing cached state credentials."); }
  }
  async function snapshot() {
    const keys = await get(base + "/resources");
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== "string")) throw new MigrationError("Legacy stage has no usable resource records.");
    const records = new Map<string, unknown>();
    for (const fqn of [...keys].sort()) {
      const file = filename(fqn);
      if (records.has(file)) throw new MigrationError("Legacy resource identities collide on disk.");
      const state = await get(base + "/resources/" + encodeURIComponent(fqn));
      if (!object(state) || state.fqn !== fqn || !["created", "updated", "ran"].includes(String(state.status))) throw new MigrationError("Legacy state is missing or has an unfinished operation; stop the app and resolve it before migration.");
      records.set(file, state);
    }
    const database = records.get("Database.json");
    if (!object(database) || !object(database.attr) || database.attr.databaseId !== options.databaseId || !String(database.resourceType).includes("D1")) throw new MigrationError("Legacy Database identity does not match the expected local database.");
    const secrets = [...records.values()].filter(value => object(value) && value.logicalId === "BetterAuthSecret" && String(value.resourceType).includes("Random") && object(value.attr) && object(value.attr.text) && typeof value.attr.text.__redacted__ === "string" && value.attr.text.__redacted__.length >= 32);
    if (!secrets.length) throw new MigrationError("Legacy signing-secret state is missing; refusing an incomplete migration.");
    const output = await get(base + "/output");
    if (output !== null && output !== undefined) records.set("__stack_output__.json", output);
    return records;
  }
  const records = await snapshot();
  const confirmation = await snapshot();
  if (JSON.stringify([...records]) !== JSON.stringify([...confirmation])) throw new MigrationError("Legacy state changed during the read; stop the app and retry.");
  const target = join(resolve(options.infrastructureDirectory), ".alchemy", "state", options.stack, options.stage);
  try { await lstat(target); throw new MigrationError("Local stage already exists; migration never overwrites it."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!options.apply) return { records: records.size, applied: false };
  const infra = resolve(options.infrastructureDirectory);
  if ((await lstat(infra)).isSymbolicLink()) throw new MigrationError("Infrastructure directory cannot be a symbolic link.");
  for (const path of [join(infra, ".alchemy"), join(infra, ".alchemy", "state"), dirname(target)]) await privateDirectory(path);
  const lock = join(dirname(target), `.${options.stage}.migration-lock`);
  await mkdir(lock, { mode: 0o700 });
  let temporary: string | undefined;
  try {
    try { await lstat(target); throw new MigrationError("Local stage already exists; migration never overwrites it."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    temporary = await mkdtemp(join(dirname(target), ".migration-"));
    await chmod(temporary, 0o700);
    for (const [file, value] of records) await writeFile(join(temporary, file), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    // The app must be stopped. The exclusive migration lock serializes importers;
    // renaming into the absent target publishes the whole stage on Windows too.
    await rename(temporary, target);
    return { records: records.size, applied: true };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await rmdir(lock);
  }
}

if (import.meta.main) {
  let logs: LocalLogs | undefined;
  let exportFailed = false;
  try {
    const [configuration, ...args] = process.argv.slice(2);
    const values: Record<string, string> = {};
    let apply = false;
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (key === "--apply" && !apply) { apply = true; continue; }
      if (!["--profile", "--stage", "--account-id", "--database-id"].includes(key) || values[key] || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new MigrationError("Invalid migration arguments.");
      values[key] = args[++i]!;
    }
    if (!configuration || ["--profile", "--stage", "--account-id", "--database-id"].some(key => !values[key]) || !segment(values["--profile"]!)) throw new MigrationError("Usage: migrate-state.ts <local.json> --profile <profile> --stage dev_<user> --account-id <expected> --database-id <existing-dev:id> [--apply]");
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) throw new MigrationError("Set OTEL_EXPORTER_OTLP_ENDPOINT to the running local receiver before migration.");
    logs = new LocalLogs(endpoint, { onExportFailure: () => { exportFailed = true; } });
    logs.emit("flarestack.state-migration", "Validating legacy local state; cloud requests are read-only.");
    await logs.flush();
    if (exportFailed) throw new MigrationError("Migration telemetry is unavailable.");
    const local = loadLocalApp(configuration);
    const credentials = JSON.parse(await readFile(credentialsFilePath(values["--profile"]!, "cloudflare-state-store"), "utf8"));
    const result = await migrateLegacyState({ infrastructureDirectory: local.infra, stack: local.stackName, stage: values["--stage"]!, accountId: values["--account-id"]!, databaseId: values["--database-id"]!, credentials, apply });
    const message = `${result.applied ? "Imported" : "Validated"} ${result.records} legacy state records. SQLite and remote state were unchanged.`;
    logs.emit("flarestack.state-migration", message);
    console.log(message);
  } catch (error) {
    const message = error instanceof MigrationError ? error.message : "Legacy migration failed; no cloud mutation was requested. Inspect the private local state directories before retrying.";
    logs?.emit("flarestack.state-migration", message, "stderr");
    console.error(message);
    process.exitCode = 1;
  } finally {
    await logs?.shutdown();
    if (exportFailed) { console.error("Migration telemetry export failed; inspect local state before retrying."); process.exitCode = 1; }
  }
}
