import { tracedRequest } from "../../../src/alchemy/tracing.ts";
import { Container, getContainer } from "@cloudflare/containers";
import type * as Cloudflare from "alchemy/Cloudflare";
import type { Worker } from "./alchemy.run.ts";
import { d1Commands } from "../../../src/alchemy/d1-bridge.ts";
import { route } from "./router.ts";

type Env = Cloudflare.InferEnv<typeof Worker>;
export class DotNet extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";
  envVars = {
    ASPNETCORE_ENVIRONMENT: "Development",
    Flarestack__Authentication__ClientId: "todo-blazor",
    Flarestack__Authentication__BackchannelBaseAddress: "http://auth.internal",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://host.docker.internal:4319",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_BSP_SCHEDULE_DELAY: "500",
    OTEL_SERVICE_NAME: "flarestack.todo",
  };
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
