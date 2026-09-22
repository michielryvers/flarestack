import { tracedRequest, telemetryPath } from "./tracing.ts";
import { Container, getContainer, type OutboundHandler } from "@cloudflare/containers";
import type { D1Database } from "@cloudflare/workers-types";
import { d1Commands } from "./d1-bridge.ts";
import { route } from "./router.ts";
import { containerSleepAfter, validateOutboundHosts, validateRoutePath } from "./extensions.ts";
import { containerEnvironment } from "./container-environment.ts";

export interface FlarestackWorkerEnv {
  Database: D1Database;
  Auth: { fetch(request: Request): Promise<Response> };
  Email?: { fetch(request: Request): Promise<Response> };
  DotNet?: Parameters<typeof getContainer>[0];
  LOCAL_ORIGIN?: string;
  LOCAL_PUBLIC_ORIGIN?: string;
  CONTAINER_SLEEP_AFTER?: string | number;
  CONTAINER_ENV: Record<string, string> | string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_EXPORTER_OTLP_HEADERS: string;
}
type Env = FlarestackWorkerEnv;
export class DotNet extends Container<Env> {
  defaultPort = 8080;
  sleepAfter: string | number = "30m";
  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args);
    this.envVars = containerEnvironment(args[1].CONTAINER_ENV);
    this.sleepAfter = containerSleepAfter(args[1].CONTAINER_SLEEP_AFTER);
  }
}
// Assignment invokes the SDK registry setter; a static field would shadow it.
const coreOutboundHosts = {
  "email.internal": (request: Request, env: Env) => env.Email ? env.Email.fetch(request) : Promise.resolve(new Response(null, {status: 503})),
  "d1.internal": (request: Request, env: Env) => tracedRequest("flarestack.d1", request, req => d1Commands(req, env.Database), env),
  "auth.internal": (request: Request, env: Env) => tracedRequest("flarestack.auth-backchannel", request, req => env.Auth.fetch(req), env),
};
DotNet.outboundByHost = coreOutboundHosts;

/** Export the returned class as DotNet from workerMain, together with ContainerProxy. */
export function createFlarestackContainer<E extends Env = Env>(options: { outboundByHost?: Record<string, OutboundHandler<E>> } = {}) {
  validateOutboundHosts(options.outboundByHost);
  const BaseDotNet = DotNet;
  // Keep the runtime class name required by Alchemy and the SDK registry.
  const ExtendedDotNet = class DotNet extends BaseDotNet {};
  ExtendedDotNet.outboundByHost = { ...coreOutboundHosts, ...options.outboundByHost };
  return ExtendedDotNet;
}
export interface FlarestackRoute<E extends Env = Env> {
  /** Exact pathname; auth, account, OIDC callbacks and /_flarestack paths are reserved. */
  path: string;
  fetch(request: Request, env: E): Response | Promise<Response>;
}
export function createFlarestackWorker<E extends Env = Env>(options: { routes?: readonly FlarestackRoute<E>[] } = {}) {
  const routes = new Map<string, FlarestackRoute<E>>();
  for (const item of options.routes ?? []) {
    validateRoutePath(item.path);
    if (routes.has(item.path)) throw new Error("Custom route paths must be unique.");
    routes.set(item.path, item);
  }
  return {

  async fetch(request: Request, env: E) {
    // Local tunnel TLS ends at cloudflared. Use explicit configuration, never
    // client-supplied forwarding headers, for the public issuer and redirects.
    if (env.LOCAL_PUBLIC_ORIGIN) {
      const url = new URL(request.url);
      const origin = new URL(env.LOCAL_PUBLIC_ORIGIN);
      url.protocol = origin.protocol; url.host = origin.host;
      request = new Request(url, request);
    }
    const started = performance.now();
    const path = telemetryPath(new URL(request.url).pathname);
    try {
      const response = await tracedRequest("flarestack.worker", request, traced => route(traced, req => env.Auth.fetch(req), req => {
        if (env.LOCAL_ORIGIN) {
          const url = new URL(req.url); const target = new URL(env.LOCAL_ORIGIN);
          url.protocol = target.protocol; url.host = target.host;
          return fetch(new Request(url, req));
        }
        if (!env.DotNet) throw new Error("Container binding missing");
        return getContainer(env.DotNet, "default").fetch(req);
      }, async req => {
        const custom = routes.get(new URL(req.url).pathname);
        return custom ? await custom.fetch(req, env) : undefined;
      }), env);
      console.log(JSON.stringify({ level: response.status >= 500 ? "ERROR" : response.status >= 400 ? "WARN" : "INFO", message: "Edge request completed", method: request.method, path, status: response.status, durationMs: performance.now() - started }));
      return response;
    } catch (error) {
      console.error(JSON.stringify({ level: "ERROR", message: "Edge request failed", method: request.method, path, durationMs: performance.now() - started }));
      throw error;
    }
  },
  };
}
export default createFlarestackWorker();

// Required by @cloudflare/containers when outboundByHost is configured.
export { ContainerProxy } from "@cloudflare/containers";
