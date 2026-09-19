import * as Cloudflare from "alchemy/Cloudflare";
export const client = { clientId: "todo-blazor", clientName: "Flarestack Todo", resourceId: "TodoOAuthClient" };
export const Database = Cloudflare.D1.Database("Database", { migrations: `${import.meta.dirname}/../migrations` });
