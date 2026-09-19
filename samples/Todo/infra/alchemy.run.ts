import { resolve } from "node:path";
import { FlarestackApp } from "@flarestack/alchemy";
import { loadLocalApp } from "@flarestack/alchemy/local/config";
import { Email } from "./email.ts";
import { Auth } from "./auth.ts";
import { Database, client } from "./config.ts";

const local = loadLocalApp(`${import.meta.dirname}/../local.json`);
export default FlarestackApp({
  name: local.stackName,
  database: Database,
  auth: Auth,
  email: Email,
  workerMain: `${import.meta.dirname}/worker.ts`,
  local: { port: local.port, bridgePort: local.bridgePort },
  container: {
    context: local.context,
    dockerfile: resolve(local.context, local.dockerfile),
    environment: {
      ASPNETCORE_ENVIRONMENT: "Development",
      Flarestack__Authentication__ClientId: client.clientId,
      Flarestack__Authentication__BackchannelBaseAddress: "http://auth.internal",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://host.docker.internal:${local.relayPort}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_BSP_SCHEDULE_DELAY: "500",
      OTEL_SERVICE_NAME: "flarestack.todo",
    },
  },
});
