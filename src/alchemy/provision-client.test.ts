const client = { clientId: "custom-blazor", clientName: "Custom App", resourceId: "CustomOAuthClient" };
import { serializeSignedCookie } from "better-call";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "./auth-options.ts";
test("provisions public PKCE client through provider API", async () => {
 const database = new Database(":memory:");
 const options = { ...authOptions("http://localhost:8787", client, true), database, secret: crypto.randomUUID()+crypto.randomUUID() };
 await (await getMigrations(options)).runMigrations();
 const auth = betterAuth(options);
 const context = await auth.$context;
 const actor = await context.internalAdapter.createUser({name:"Provisioner",email:"provisioner@flarestack.invalid"}, {method:"admin"});
 const session = await context.internalAdapter.createSession(actor.id, false);
 const cookie = await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, context.secret, {path:"/"});
 const headers = new Headers({cookie:cookie.split(";")[0]!});
 try {
 const result = await auth.api.adminCreateOAuthClient({headers, body:{application_type:"native",client_name:client.clientName,redirect_uris:["http://localhost:8787/signin-oidc"],post_logout_redirect_uris:["http://localhost:8787/signout-callback-oidc"],token_endpoint_auth_method:"none",grant_types:["authorization_code"],response_types:["code"],scope:"openid profile email",skip_consent:true,require_pkce:true,enable_end_session:true}});
 expect(result.client_id).toBe(client.clientId);
 expect(result.token_endpoint_auth_method).toBe("none");
 await auth.api.adminUpdateOAuthClient({headers,body:{client_id:client.clientId,update:{client_name:client.clientName,skip_consent:true}}});
 expect(database.query('SELECT COUNT(*) AS count FROM "oauthClient"').get()).toEqual({count:1});
 await context.internalAdapter.deleteSession(session.token);
 expect(database.query('SELECT COUNT(*) AS count FROM "session"').get()).toEqual({count:0});
 } finally { database.close(); }
});
