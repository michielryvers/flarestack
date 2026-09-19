import { createAuthWorker } from "../../../src/alchemy/index.ts";
import { Database, client } from "./config.ts";
export const Auth = createAuthWorker({ main: import.meta.url, database: Database, client });
export default Auth;
