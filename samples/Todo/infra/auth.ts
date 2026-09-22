import { createAuthWorker } from "@flarestack/alchemy";
import { loadAppEnvironment } from "@flarestack/alchemy/deploy/config";
import { Email } from "./email.ts";
import { Database, client } from "./config.ts";

// Alchemy captures deployment settings as Worker bindings; no files are read in a Worker.
const app = globalThis.__ALCHEMY_RUNTIME__ ? undefined : loadAppEnvironment(`${import.meta.dirname}/../local.json`, client.clientId);
export const Auth = createAuthWorker({
  main: import.meta.url,
  database: Database,
  client,
  email: app?.email ? Email : undefined,
  features: { requireEmailVerification: app?.email?.requireVerification ?? false },
});
export default Auth;
