/** Read-only cloud boundary check; it never deploys, creates accounts or sends email. */
export async function smokeCloud(origin: string, stage: string, appName: string, fetcher: typeof fetch = fetch) {
  if (!["staging", "production"].includes(stage) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName)) {
    throw new Error("Set an explicit FLARESTACK_SMOKE_APP_NAME and FLARESTACK_SMOKE_STAGE=staging|production.");
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new Error("Cloud smoke requires a canonical HTTPS origin.");
  const read = (path: string, method = "GET") => fetcher(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const discovery = await read("/auth/.well-known/openid-configuration");
  if (!discovery.ok) throw new Error("OIDC discovery failed.");
  const metadata = await discovery.json() as Record<string, unknown>;
  if (metadata.issuer !== `${origin}/auth`) throw new Error("Public OIDC issuer mismatch.");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (typeof metadata[key] !== "string" || new URL(metadata[key]).origin !== origin) throw new Error("OIDC endpoints do not match the public origin.");
  }
  for (const path of ["/_flarestack/health", "/_flarestack/ready", "/health"]) {
    if (!(await read(path)).ok) throw new Error("A cloud health check failed.");
  }
  for (const path of ["/_flarestack/internal/users", "/_flarestack/d1"]) {
    if ((await read(path, "POST")).status !== 404) throw new Error("A private route is exposed.");
  }
}

if (import.meta.main) {
  try {
    await smokeCloud(process.env.FLARESTACK_SMOKE_ORIGIN ?? "", process.env.FLARESTACK_SMOKE_STAGE ?? "", process.env.FLARESTACK_SMOKE_APP_NAME ?? "");
    console.log("PASS: named cloud target HTTPS discovery, health and private-route boundary. Authenticated CRUD and email were not tested.");
  } catch {
    console.error("Cloud preflight failed. Supply canonical HTTPS FLARESTACK_SMOKE_ORIGIN, FLARESTACK_SMOKE_APP_NAME, and FLARESTACK_SMOKE_STAGE=staging|production; inspect the deployed endpoints.");
    process.exitCode = 1;
  }
}
