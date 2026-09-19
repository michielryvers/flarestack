import { createEmailWorker } from "@flarestack/alchemy";
export const Email = createEmailWorker({ main: import.meta.url, from: "noreply@flarestack.local" });
export default Email;
