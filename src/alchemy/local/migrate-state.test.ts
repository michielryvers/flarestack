import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviveStateRecursive } from "alchemy/State/StateEncoding";
import * as Redacted from "effect/Redacted";
import { migrateLegacyState, type MigrationOptions } from "./migrate-state.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "flarestack-state-migration-"));
  const options: MigrationOptions = { infrastructureDirectory: root, stack: "notes", stage: "dev_fixture", accountId: "fixture-account", databaseId: "dev:fixture-db", credentials: { url: "https://state.example.com", authToken: "fixture-private-token", accountId: "fixture-account" } };
  const records: Record<string, Record<string, unknown>> = {
    Database: { fqn: "Database", logicalId: "Database", resourceType: "Cloudflare.D1Database", status: "created", attr: { databaseId: "dev:fixture-db" } },
    "Auth/BetterAuthSecret": { fqn: "Auth/BetterAuthSecret", logicalId: "BetterAuthSecret", resourceType: "Alchemy.Random", status: "created", attr: { text: { __redacted__: "fixture-private-signing-secret-value" } } },
    "Auth/ProvisionClient": { fqn: "Auth/ProvisionClient", logicalId: "ProvisionClient", kind: "action", status: "ran", output: { done: true } },
  };
  const paths: string[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-private-token");
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const prefix = "/state/stacks/notes/stages/dev_fixture";
    expect(path.startsWith(prefix + "/")).toBe(true);
    if (path === prefix + "/resources") return Response.json(Object.keys(records));
    if (path === prefix + "/output") return Response.json({ url: "http://localhost:8787" });
    const name = decodeURIComponent(path.slice((prefix + "/resources/").length));
    return Response.json(records[name] ?? null);
  }) as typeof fetch;
  return { root, options, records, request, paths, target: join(root, ".alchemy/state/notes/dev_fixture") };
}

test("dry-run reads only exact stage, preserves encoded secrets, and applies atomically with private permissions", async () => {
  const f = await fixture();
  try {
    expect(await migrateLegacyState(f.options, f.request)).toEqual({ records: 4, applied: false });
    expect(await readdir(f.root)).toEqual([]);
    expect(await migrateLegacyState({ ...f.options, apply: true }, f.request)).toEqual({ records: 4, applied: true });
    const stored = JSON.parse(await readFile(join(f.target, "Auth__BetterAuthSecret.json"), "utf8"));
    expect(stored).toEqual(f.records["Auth/BetterAuthSecret"]);
    const revived = reviveStateRecursive(stored) as { attr: { text: Redacted.Redacted<string> } };
    expect(Redacted.isRedacted(revived.attr.text)).toBe(true);
    expect(Redacted.value(revived.attr.text)).toBe("fixture-private-signing-secret-value");
    expect(JSON.parse(await readFile(join(f.target, "Database.json"), "utf8"))).toEqual(f.records.Database);
    expect(await readdir(join(f.root, ".alchemy/state/notes"))).toEqual(["dev_fixture"]);
    if (process.platform !== "win32") {
      expect((await lstat(f.target)).mode & 0o777).toBe(0o700);
      expect((await lstat(join(f.target, "Database.json"))).mode & 0o777).toBe(0o600);
    }
    await expect(migrateLegacyState({ ...f.options, apply: true }, f.request)).rejects.toThrow("never overwrites");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test.each(["staging", "production", "dev_../outside"])("rejects nonlegacy stage %s before remote reads", async stage => {
  const f = await fixture();
  try {
    await expect(migrateLegacyState({ ...f.options, stage }, f.request)).rejects.toThrow("legacy dev_");
    expect(f.paths).toHaveLength(0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("rejects wrong account/database, missing secret, and unfinished state without local writes", async () => {
  const f = await fixture();
  try {
    await expect(migrateLegacyState({ ...f.options, accountId: "other" }, f.request)).rejects.toThrow("expected account");
    expect(f.paths).toHaveLength(0);
    await expect(migrateLegacyState({ ...f.options, databaseId: "dev:other", apply: true }, f.request)).rejects.toThrow("expected local database");
    f.records["Auth/BetterAuthSecret"]!.attr = { text: "<redacted>" };
    await expect(migrateLegacyState({ ...f.options, apply: true }, f.request)).rejects.toThrow("signing-secret");
    f.records.Database!.status = "updating";
    await expect(migrateLegacyState({ ...f.options, apply: true }, f.request)).rejects.toThrow("unfinished");
    expect(await readdir(f.root)).toEqual([]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("rejects existing empty target rather than replacing it", async () => {
  const f = await fixture();
  try {
    await mkdir(f.target, { recursive: true });
    await expect(migrateLegacyState({ ...f.options, apply: true }, f.request)).rejects.toThrow("never overwrites");
    expect(await readdir(f.target)).toEqual([]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("rejects a changing remote snapshot before local writes", async () => {
  const f = await fixture();
  let reads = 0;
  const changing = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/resources")) {
      if (++reads === 2) f.records.Database!.instanceId = "changed";
    }
    return f.request(input, init);
  }) as typeof fetch;
  try {
    await expect(migrateLegacyState({ ...f.options, apply: true }, changing)).rejects.toThrow("changed during the read");
    expect(await readdir(f.root)).toEqual([]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("remote failures never disclose credentials or response bodies", async () => {
  const f = await fixture();
  const failure = (async (_input: string | URL | Request, _init?: RequestInit) => new Response("fixture-private-token fixture-private-signing-secret-value", { status: 401 })) as typeof fetch;
  try {
    let message = "";
    try { await migrateLegacyState(f.options, failure); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain("Legacy state read failed");
    expect(message).not.toContain("fixture-private");
    expect(await readdir(f.root)).toEqual([]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
