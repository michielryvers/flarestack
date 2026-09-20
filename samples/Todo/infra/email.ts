import { createEmailWorker } from "@flarestack/alchemy";
export const Email = createEmailWorker({ main: import.meta.url, from: process.env.FLARESTACK_EMAIL_FROM ?? "noreply@flarestack.local" });
export default Email;
