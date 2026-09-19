import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { DotNet } from "./worker.ts";
import type { createAuthWorker } from "./auth.ts";
import { protocolVersion } from "./protocol.ts";

export interface FlarestackAppOptions {
  /** Stable stack identity; changing it creates different resources. */
  name: string;
  database: ReturnType<typeof Cloudflare.D1.Database>;
  auth: ReturnType<typeof createAuthWorker>;
  email?: ReturnType<typeof import("./email.ts").createEmailWorker>;
  workerMain: string;
  container: { context: string; dockerfile: string; environment: Record<string, string> };
  local: { port: number; bridgePort: number };
}

/** Compose the resource graph. The caller owns the D1 migrations and auth entrypoint. */
export function FlarestackApp(options: FlarestackAppOptions) {
  const mode = process.env.FLARESTACK_LOCAL_MODE ?? "Container";
  if (mode !== "Fast" && mode !== "Container") throw new Error("FLARESTACK_LOCAL_MODE must be Fast or Container");
  const fast = mode === "Fast";
  if (fast && (!process.env.FLARESTACK_LOCAL_BRIDGE_TOKEN || !process.env.FLARESTACK_LOCAL_ORIGIN))
    throw new Error("Fast mode requires an AppHost-managed origin and bridge token");
  const telemetry = {
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318",
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "",
  };
  const DotNetImage = Cloudflare.Container<DotNet>("DotNetImage", {
    context: options.container.context, dockerfile: options.container.dockerfile,
    className: "DotNet", ports: [{ name: "http", port: 8080 }], instanceType: "lite",
  });
  const bindings = { Database: options.database, Auth: options.auth, ...(options.email ? { Email: options.email } : {}), ...telemetry };
  const LocalBridge = fast ? Cloudflare.Worker("LocalBridge", {
    main: `${import.meta.dirname}/local-bridge.ts`, workersDev: false,
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
    dev: { host: "127.0.0.1", port: options.local.bridgePort, strictPort: true },
    env: { ...bindings, LOCAL_BRIDGE_TOKEN: process.env.FLARESTACK_LOCAL_BRIDGE_TOKEN! },
  }) : undefined;
  const Worker = Cloudflare.Worker("Edge", {
    main: options.workerMain,
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
    dev: { port: options.local.port, strictPort: true },
    env: { ...bindings, ...(fast ? {} : { DotNet: DotNetImage }),
      LOCAL_ORIGIN: fast ? process.env.FLARESTACK_LOCAL_ORIGIN! : "",
      CONTAINER_ENV: options.container.environment },
  });
  return Alchemy.Stack(options.name, { providers: Cloudflare.providers(), state: Cloudflare.state() },
    Effect.gen(function* () {
      if (LocalBridge) yield* LocalBridge;
      const worker = yield* Worker;
      return { url: worker.url, protocolVersion };
    }));
}
