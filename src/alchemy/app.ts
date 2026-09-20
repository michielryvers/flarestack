import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Layer from "effect/Layer";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Stage } from "alchemy/Stage";
import { prepareLocalState } from "./local/state.ts";
import type { DotNet } from "./worker.ts";
import type { createAuthWorker } from "./auth.ts";
import { containerSleepAfter, validateAdditionalBindings, validateContainerCount } from "./extensions.ts";
import { protocolVersion } from "./protocol.ts";

export interface FlarestackAppOptions {
  /** Stable stack identity; changing it creates different resources. */
  name: string;
  database: ReturnType<typeof Cloudflare.D1.Database>;
  auth: ReturnType<typeof createAuthWorker>;
  email?: ReturnType<typeof import("./email.ts").createEmailWorker>;
  workerMain: string;
  container: {
    context: string;
    dockerfile: string;
    environment: Record<string, string>;
    instanceType?: Cloudflare.Containers.ContainerApplication.InstanceType;
    maxInstances?: 1;
    /** Positive seconds or an SDK duration such as 30m. */
    sleepAfter?: string | number;
  };
  /** Additional Edge Worker bindings; framework names and prefixes are reserved. */
  bindings?: Cloudflare.WorkerBindingProps;
  observability?: {
    worker?: Cloudflare.WorkerObservability;
    container?: Cloudflare.Containers.ContainerApplication.Observability;
  };
  local: { port: number; bridgePort: number };
  /** Optional canonical HTTPS hostname for a cloud deployment. */
  domain?: string;
  /** Stable explicit cloud Worker name; supplied by loadAppEnvironment. */
  workerName?: string;
}

/** Compose the resource graph. The caller owns the D1 migrations and auth entrypoint. */
export function FlarestackApp(options: FlarestackAppOptions) {
  validateAdditionalBindings(options.bindings);
  validateContainerCount(options.container.maxInstances);
  const sleepAfter = containerSleepAfter(options.container.sleepAfter);
  const mode = process.env.FLARESTACK_LOCAL_MODE ?? "Container";
  if (mode !== "Fast" && mode !== "Container") throw new Error("FLARESTACK_LOCAL_MODE must be Fast or Container");
  const fast = mode === "Fast";
  if (fast && (!process.env.FLARESTACK_LOCAL_BRIDGE_TOKEN || !process.env.FLARESTACK_LOCAL_ORIGIN))
    throw new Error("Fast mode requires an AppHost-managed origin and bridge token");
  const telemetry = {
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.FLARESTACK_DEPLOY === "1" ? (process.env.FLARESTACK_CLOUD_OTLP_ENDPOINT ?? "") : process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318",
    OTEL_EXPORTER_OTLP_HEADERS: process.env.FLARESTACK_DEPLOY === "1" ? Redacted.make(process.env.FLARESTACK_CLOUD_OTLP_HEADERS ?? "") : process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "",
  };
  const DotNetImage = Cloudflare.Container<DotNet>("DotNetImage", {
    context: options.container.context, dockerfile: options.container.dockerfile,
    className: "DotNet", ports: [{ name: "http", port: 8080 }], instanceType: options.container.instanceType ?? "lite",
    maxInstances: 1,
    observability: options.observability?.container ?? { logs: { enabled: true } },
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
    name: options.workerName,
    domain: options.domain,
    workersDev: options.domain ? false : true,
    observability: options.observability?.worker ?? { enabled: true },
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
    dev: { port: options.local.port, strictPort: true },
    env: { ...options.bindings, ...bindings, ...(fast ? {} : { DotNet: DotNetImage }),
      CONTAINER_SLEEP_AFTER: sleepAfter,
      LOCAL_PUBLIC_ORIGIN: process.env.FLARESTACK_DEPLOY === "1" ? "" : process.env.PUBLIC_ORIGIN ?? "",
      LOCAL_ORIGIN: fast ? process.env.FLARESTACK_LOCAL_ORIGIN! : "",
      CONTAINER_ENV: process.env.FLARESTACK_DEPLOY === "1"
        ? Redacted.make(JSON.stringify(options.container.environment))
        : { ...options.container.environment, ...(process.env.FLARESTACK_LOCAL_OTLP_HEADERS ? { OTEL_EXPORTER_OTLP_HEADERS: process.env.FLARESTACK_LOCAL_OTLP_HEADERS } : {}) } },
  });
  const state = Layer.unwrap(Effect.gen(function* () {
    const context = yield* AlchemyContext;
    if (!context.dev) return Cloudflare.state();
    const stage = yield* Stage;
    yield* Effect.promise(() => prepareLocalState(context.dotAlchemy, options.name, stage));
    return Alchemy.localState();
  }));
  return Alchemy.Stack(options.name, { providers: Cloudflare.providers(), state },
    Effect.gen(function* () {
      if (LocalBridge) yield* LocalBridge;
      const worker = yield* Worker;
      return { url: worker.url, protocolVersion };
    }));
}
