import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { acceptanceArguments, acceptanceWorkspace, browserFailureDiagnostics, deploymentResult, migrationSql } from "./cloud-acceptance.ts";
import { smokeCloud } from "./smoke-cloud.ts";

const argumentsFor = (stage: string) => ["--app-name", "FlarestackJourneyTest", "--workspace", resolve(tmpdir(), "stable-acceptance"), "--stage", stage, "--template", "packed-template.nupkg"];

test("mutating acceptance requires an explicit safe application identity and staging", () => {
  expect(acceptanceArguments(argumentsFor("staging")).stage).toBe("staging");
  expect(() => acceptanceArguments(argumentsFor("production"))).toThrow("only targets");
  expect(() => acceptanceArguments([])).toThrow("explicit");
  expect(() => acceptanceArguments([...argumentsFor("staging"), "--destroy", "yes"])).toThrow("Use --app-name");
  const hostile = argumentsFor("staging"); hostile[1] = "../another-app";
  expect(() => acceptanceArguments(hostile)).toThrow("ASCII letters");
  const relative = argumentsFor("staging"); relative[3] = "relative";
  expect(() => acceptanceArguments(relative)).toThrow("absolute stable");
});

test("observable migration changes only the retained synthetic row and rejects SQL-shaped identifiers", () => {
  const id = "ae48ca89-712b-45a3-9731-b9b5b5c37e2a";
  expect(migrationSql({ id, title: "synthetic" })).toContain(`WHERE id = '${id}'`);
  expect(migrationSql({ id, title: "synthetic" })).toContain("title || ' migrated'");
  expect(() => migrationSql({ id: "x'; DELETE FROM todo; --", title: "synthetic" })).toThrow("identifier format");
});

test("deployment outputs cannot switch the runner to another named app, stage or insecure origin", () => {
  const state = { stackName: "app-test", environment: "staging", status: "deployed", origin: "https://example.workers.dev" };
  expect(deploymentResult(state, "app-test")).toBe(state.origin);
  expect(() => deploymentResult(state, "app-other")).toThrow("identity");
  expect(() => deploymentResult({ ...state, environment: "production" }, "app-test")).toThrow("identity");
  for (const origin of ["http://example.test", "https://example.test/path", "https://user:password@example.test"]) {
    expect(() => deploymentResult({ ...state, origin }, "app-test")).toThrow("canonical HTTPS");
  }
});

test("read-only cloud smoke verifies canonical metadata and private boundaries without deployment", async () => {
  const paths: Array<[string, string]> = [];
  const origin = "https://app-staging.example.test";
  const fetcher = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push([path, init?.method ?? "GET"]);
    if (path.includes("well-known")) return Response.json({ issuer: `${origin}/auth`, authorization_endpoint: `${origin}/auth/authorize`, token_endpoint: `${origin}/auth/token`, jwks_uri: `${origin}/auth/jwks` });
    return new Response(null, { status: path.startsWith("/_flarestack/internal") || path === "/_flarestack/d1" ? 404 : 200 });
  }) as typeof fetch;
  await smokeCloud(origin, "staging", "app-test", fetcher);
  expect(paths).toHaveLength(6);
  expect(paths.filter(([, method]) => method === "POST")).toEqual([["/_flarestack/internal/users", "POST"], ["/_flarestack/d1", "POST"]]);
  await expect(smokeCloud(origin, "preview-old", "app-test", fetcher)).rejects.toThrow("staging|production");
  const wrongIssuer = (async () => Response.json({ issuer: "https://other.example/auth" })) as unknown as typeof fetch;
  await expect(smokeCloud(origin, "production", "app-test", wrongIssuer)).rejects.toThrow("issuer mismatch");
});


test("private workspace resolves ancestor links and rejects the repository through aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloud-workspace-"));
  try {
    const repository = join(root, "source");
    await mkdir(repository);
    const alias = join(root, "alias");
    await symlink(repository, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(acceptanceWorkspace(repository, join(alias, "new", "workspace"))).rejects.toThrow("outside");
    expect(await acceptanceWorkspace(repository, join(root, "outside", "new"))).toBe(join(await realpath(root), "outside", "new"));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("browser failures retain path-only state and omit credentials, query data and DOM call logs", () => {
  const error = new Error('page.waitForURL: timeout at https://app.test/auth?code=private-code&state=private-state user@example.test saved-password\nCall log: sensitive DOM excerpt');
  const result = browserFailureDiagnostics(error, ["https://app.test/auth?state=private-state#fragment"], { acceptance_password: "saved-password" });
  expect(JSON.parse(result).pagePaths).toEqual(["/auth"]);
  expect(result).toContain("page.waitForURL");
  for (const secret of ["private-code", "private-state", "user@example.test", "saved-password", "sensitive DOM", "fragment", "https://"]) expect(result).not.toContain(secret);
});
