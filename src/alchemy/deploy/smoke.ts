import { DeploymentError } from "./config.ts";

/** Read-only deployed boundary checks. Does not claim CRUD, login or email coverage. */
export async function smokeDeployment(origin: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const read = (path: string, method = "GET") => fetcher(origin + path, {
    method, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const discovery = await read("/auth/.well-known/openid-configuration");
  if (!discovery.ok) throw new DeploymentError("Deployed OIDC discovery is unavailable.");
  const metadata = await discovery.json() as Record<string, unknown>;
  if (metadata.issuer !== `${origin}/auth`) throw new DeploymentError("Deployed OIDC issuer does not match the canonical origin.");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    const value = metadata[key];
    if (typeof value !== "string" || new URL(value).origin !== origin) throw new DeploymentError("Deployed OIDC endpoints do not match the canonical origin.");
  }
  for (const path of ["/_flarestack/health", "/_flarestack/ready", "/health"]) {
    if (!(await read(path)).ok) throw new DeploymentError("A deployed health endpoint is unavailable.");
  }
  for (const path of ["/_flarestack/internal/users", "/_flarestack/d1"]) {
    if ((await read(path, "POST")).status !== 404) throw new DeploymentError("A private deployed route is publicly accessible.");
  }
}
