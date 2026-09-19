import { serializeSignedCookie } from "better-call";
import { Action } from "alchemy";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import { Database } from "@alchemy.run/better-auth/Database";
import { betterAuth } from "better-auth";
import { getSchema } from "better-auth/db";
import { getMigrations } from "better-auth/db/migration";
import * as Effect from "effect/Effect";
import { authOptions, type AuthFeatures, type OAuthClientOptions } from "./auth-options.ts";

export const provisionClient = (origin: string, client: OAuthClientOptions, features: AuthFeatures = {}): Effect.Effect<void, never, Database> => Effect.gen(function* () {
  const db = yield* Database;
  const support = db.migrate!;
  const Ensure = Action("Flarestack.OAuthClient", Effect.gen(function* () {
    const acquire = yield* support.connect;
    return (_input: { identity: Record<string, unknown>; origin: string; revision: number; schema: string; client: OAuthClientOptions }) => Effect.scoped(Effect.gen(function* () {
      const database = yield* acquire;
      yield* Effect.promise(async () => {
        const options = { ...authOptions(origin, client, true, features), database, secret: "provisioning-only-not-used-to-issue-tokens", telemetry: { enabled: false } };
        await (await getMigrations(options)).runMigrations();
        const auth = betterAuth(options);
        const context = await auth.$context;
        // Server-only provisioning uses a passwordless service identity and a short-lived
        // session. The signed cookie never leaves this process; public runtime denies
        // every client-management action. No hand-written OAuth table mutations.
        let actor = await context.adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "id", value: "flarestack-provisioner" }] });
        if (!actor) actor = await context.internalAdapter.createUser({ id: "flarestack-provisioner", name: "Flarestack provisioner", email: "provisioner@flarestack.invalid", emailVerified: false }, { method: "admin" });
        const session = await context.internalAdapter.createSession(actor.id, false);
        const cookie = await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, context.secret, { path: "/" });
        const headers = new Headers({ cookie: cookie.split(";")[0]! });
        const existing = await context.adapter.findOne({ model: "oauthClient", where: [{ field: "clientId", value: client.clientId }] });
        const metadata = {
          application_type: origin.startsWith("http:") ? "native" as const : "web" as const,
          client_name: client.clientName, redirect_uris: [`${origin}/signin-oidc`],
          post_logout_redirect_uris: [`${origin}/signout-callback-oidc`],
          token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code" as const],
          scope: "openid profile email", skip_consent: true, require_pkce: true, enable_end_session: true,
        };
        try {
          if (existing) await auth.api.adminUpdateOAuthClient({ headers, body: { client_id: client.clientId, update: metadata } });
          else await auth.api.adminCreateOAuthClient({ headers, body: metadata });
        } finally { await context.internalAdapter.deleteSession(session.token); }
      });
      return { clientId: client.clientId };
    }));
  }));
  const result = yield* Ensure(client.resourceId, { identity: support.identity, origin, client, revision: 4, schema: JSON.stringify(getSchema(authOptions(origin, client, false, features))) });
  const runtime = yield* CurrentRuntimeContext;
  if (runtime) yield* runtime.set(client.resourceId, result as never);
}) as Effect.Effect<void, never, Database>;
