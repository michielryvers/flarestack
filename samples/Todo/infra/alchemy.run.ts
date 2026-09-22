import { FlarestackApp } from "@flarestack/alchemy";
import { loadAppEnvironment } from "@flarestack/alchemy/deploy/config";
import { Email } from "./email.ts";
import { Auth } from "./auth.ts";
import { Database, client } from "./config.ts";

const app = loadAppEnvironment(`${import.meta.dirname}/../local.json`, client.clientId);
export default FlarestackApp({
  name: app.local.stackName,
  database: Database,
  auth: Auth,
  email: app.email ? Email : undefined,
  workerMain: `${import.meta.dirname}/worker.ts`,
  workerName: app.workerName,
  domain: app.domain,
  local: { port: app.local.port, bridgePort: app.local.bridgePort },
  container: app.container,
});
