import { createEmailWorker } from "@flarestack/alchemy";
import { loadAppEnvironment } from "@flarestack/alchemy/deploy/config";
import { client } from "./config.ts";

const app = globalThis.__ALCHEMY_RUNTIME__ ? undefined : loadAppEnvironment(`${import.meta.dirname}/../local.json`, client.clientId);
export const Email = createEmailWorker({ main: import.meta.url, from: app?.email?.from ?? "noreply@flarestack.local" });
export default Email;
