import { tracedRequest } from "./tracing.ts";
import { Container, getContainer } from "@cloudflare/containers";
import type { D1Database } from "@cloudflare/workers-types";
import { d1Commands } from "./d1-bridge.ts";
import { route } from "./router.ts";

export interface FlarestackWorkerEnv {
  Database: D1Database;
  Auth: { fetch(request: Request): Promise<Response> };
  DotNet?: Parameters<typeof getContainer>[0];
  LOCAL_ORIGIN?: string;
  CONTAINER_ENV: Record<string, string>;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_EXPORTER_OTLP_HEADERS: string;
}
type Env = FlarestackWorkerEnv;
export class DotNet extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";
  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args);
    this.envVars = args[1].CONTAINER_ENV;
  }
}
// Assignment invokes the SDK registry setter; a static field would shadow it.
DotNet.outboundByHost = {
  "d1.internal": (request: Request, env: Env) => tracedRequest("flarestack.d1", request, req => d1Commands(req, env.Database), env),
  "auth.internal": (request: Request, env: Env) => tracedRequest("flarestack.auth-backchannel", request, req => env.Auth.fetch(req), env),
};
export default {
  async fetch(request: Request, env: Env) {
    const started = performance.now();
    const path = new URL(request.url).pathname;
    try {
      const response = await tracedRequest("flarestack.worker", request, traced => route(traced, req => env.Auth.fetch(req), req => {
        if (env.LOCAL_ORIGIN) {
          const url = new URL(req.url); const target = new URL(env.LOCAL_ORIGIN);
          url.protocol = target.protocol; url.host = target.host;
          return fetch(new Request(url, req));
        }
        if (!env.DotNet) throw new Error("Container binding missing");
        return getContainer(env.DotNet, "default").fetch(req);
      }), env);
      console.log(JSON.stringify({ level: response.status >= 500 ? "ERROR" : response.status >= 400 ? "WARN" : "INFO", message: "Edge request completed", method: request.method, path, status: response.status, durationMs: performance.now() - started }));
      return response;
    } catch (error) {
      console.error(JSON.stringify({ level: "ERROR", message: "Edge request failed", method: request.method, path, durationMs: performance.now() - started }));
      throw error;
    }
  },
};

// Required by @cloudflare/containers when outboundByHost is configured.
export { ContainerProxy } from "@cloudflare/containers";
