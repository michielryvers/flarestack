import { resolve } from "node:path";
import { FlarestackApp } from "@flarestack/alchemy";
import { Database, client } from "./config.ts";
import { Auth } from "./auth.ts";
import { Email } from "./email.ts";

const origin = new URL(process.env.PUBLIC_ORIGIN!);
if (origin.protocol !== "https:" || origin.origin !== process.env.PUBLIC_ORIGIN || process.env.FLARESTACK_DEPLOY !== "1")
  throw new Error("Use the cloud deployment runner with a canonical HTTPS origin.");
export default FlarestackApp({
  name: "flarestack-preview", domain: origin.hostname,
  database: Database, auth: Auth, email: Email,
  workerMain: `${import.meta.dirname}/worker.ts`, local: { port: 8787, bridgePort: 8789 },
  container: {
    context: resolve(import.meta.dirname, "../../../.alchemy/cloud-build"),
    dockerfile: resolve(import.meta.dirname, "../../../.alchemy/cloud-build/samples/Todo/Dockerfile"),
    environment: {
      ASPNETCORE_ENVIRONMENT: "Production",
      Flarestack__Authentication__Authority: `${origin.origin}/auth`,
      Flarestack__Authentication__ClientId: client.clientId,
      Flarestack__Authentication__BackchannelBaseAddress: "http://auth.internal",
      OTEL_SDK_DISABLED: process.env.FLARESTACK_CLOUD_OTLP_ENDPOINT ? "false" : "true",
      ...(process.env.FLARESTACK_CLOUD_OTLP_ENDPOINT ? {OTEL_EXPORTER_OTLP_ENDPOINT: process.env.FLARESTACK_CLOUD_OTLP_ENDPOINT} : {}),
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf", OTEL_SERVICE_NAME: "flarestack.todo",
    },
  },
});
