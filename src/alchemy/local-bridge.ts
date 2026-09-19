import type { D1Database } from "@cloudflare/workers-types";
import { d1Commands } from "./d1-bridge.ts";
import { tracedRequest } from "./tracing.ts";
interface Env {
  Database: D1Database;
  Auth: { fetch(request: Request): Promise<Response> };
  LOCAL_BRIDGE_TOKEN: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_EXPORTER_OTLP_HEADERS: string;
}
// Created only in explicitly selected fast local mode, on a loopback listener.
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (!env.LOCAL_BRIDGE_TOKEN || request.headers.get("x-flarestack-bridge") !== env.LOCAL_BRIDGE_TOKEN) return new Response(null, { status: 403 });
  const url = new URL(request.url);
  const headers = new Headers(request.headers); headers.delete("x-flarestack-bridge");
  if (url.pathname === "/v1/commands") {
    url.hostname = "d1.internal"; url.port = "";
    return tracedRequest("flarestack.d1", new Request(url, new Request(request, {headers})), req => d1Commands(req, env.Database), env);
  }
  if (url.pathname.startsWith("/auth/") || url.pathname === "/.well-known/openid-configuration/auth")
    return tracedRequest("flarestack.auth-backchannel", new Request(request, {headers}), req => env.Auth.fetch(req), env);
  return new Response(null, {status:404});
} };
