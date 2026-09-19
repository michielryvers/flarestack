import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Auth, Database } from "./auth.ts";
import type { DotNet } from "./worker.ts";

// Current async binding overload returns a class declaration carrying its DO type.
export class DotNetImage extends Cloudflare.Container<DotNet>("DotNetImage", {
  context: `${import.meta.dirname}/../../../.alchemy/todo-build`,
  dockerfile: `${import.meta.dirname}/../../../.alchemy/todo-build/samples/Todo/Dockerfile`,
  className: "DotNet",
  ports: [{ name: "http", port: 8080 }],
  instanceType: "lite",
}) {}
const fast = process.env.FLARESTACK_LOCAL_MODE === "Fast";
const telemetry = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318",
  OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "",
};
if (fast && (!process.env.FLARESTACK_LOCAL_BRIDGE_TOKEN || !process.env.FLARESTACK_LOCAL_ORIGIN)) throw new Error("Fast mode requires an AppHost-managed origin and bridge token");
export const LocalBridge = fast ? Cloudflare.Worker("LocalBridge", {
  main: "../../../src/alchemy/local-bridge.ts", workersDev: false,
  compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
  dev: { host: "127.0.0.1", port: 8789, strictPort: true },
  env: { Database, Auth, LOCAL_BRIDGE_TOKEN: process.env.FLARESTACK_LOCAL_BRIDGE_TOKEN!, ...telemetry },
}) : undefined;
export const Worker = Cloudflare.Worker("Edge", {
  main: "./worker.ts",
  compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
  dev: { port: 8787, strictPort: true },
  env: { ...(fast ? {} : { DotNet: DotNetImage }), Database, Auth, LOCAL_ORIGIN: fast ? process.env.FLARESTACK_LOCAL_ORIGIN! : "", ...telemetry },
});
export default Alchemy.Stack("flarestack-compatibility", {
  providers: Cloudflare.providers(), state: Cloudflare.state(),
}, Effect.gen(function* () {
  if (LocalBridge) yield* LocalBridge;
  const worker = yield* Worker;
  return { url: worker.url, protocolVersion: 1 };
}));
