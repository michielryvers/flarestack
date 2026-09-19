import { createAuthWorker } from "@flarestack/alchemy";
import { Email } from "./email.ts";
import { Database, client } from "./config.ts";
export const Auth = createAuthWorker({ main: import.meta.url, database: Database, client, email: Email, features: { requireEmailVerification: true } });
export default Auth;
