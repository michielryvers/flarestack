import type { BetterAuthOptions } from "better-auth";
import { authEmailPolicy } from "./auth-email-policy.ts";
import { protocolHeaders, protocolVersion, privateRequest } from "./protocol.ts";
import { internalAuth } from "./auth-internal.ts";
import { telemetryPath } from "./tracing.ts";
import { BetterAuth } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { authOptions, type AuthFeatures, type OAuthClientOptions } from "./auth-options.ts";

export interface AuthWorkerOptions {
  /** Module that exports the returned Worker as default. */
  main: string;
  database: Parameters<typeof CloudflareD1>[0];
  client: OAuthClientOptions;
  email?: ReturnType<typeof import("./email.ts").createEmailWorker>;
  features?: AuthFeatures;
  /** Resolve provider credentials through Config.Redacted inside the Worker effect. */
  socialProviders?: Effect.Effect<NonNullable<BetterAuthOptions["socialProviders"]>, Config.ConfigError>;
}

export function createAuthWorker(options: AuthWorkerOptions) {
  return Cloudflare.Worker("Auth", {
    main: options.main, workersDev: false,
    observability: { enabled: true },
    env: { ...(options.email ? { Email: options.email } : {}), FLARESTACK_ADMIN_USER_IDS: process.env.FLARESTACK_ADMIN_USER_IDS ?? "", FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION: String(options.features?.requireEmailVerification ?? false) },
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
  }, Effect.gen(function* () {
    const publicOrigin = yield* Config.String("PUBLIC_ORIGIN");
    const socialProviders = options.socialProviders ? yield* options.socialProviders : undefined;
    // One action owns schema migration followed by client provisioning. Separate
    // Alchemy actions run concurrently and race CREATE TABLE on a fresh D1.
    const env = yield* Cloudflare.WorkerEnvironment;
    const { requireEmailVerification, hasEmail } = authEmailPolicy(
      { requireVerification: options.features?.requireEmailVerification ?? false, hasEmail: !!options.email },
      globalThis.__ALCHEMY_RUNTIME__ ? env : undefined,
    );
    const features = { ...options.features, requireEmailVerification, adminUserIds: String(env.FLARESTACK_ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean) };
    const sendEmail = hasEmail ? async (message: {to: string; subject: string; text: string}, request?: Request) => {
      const headers = new Headers({"content-type": "application/json", ...protocolHeaders});
      for (const name of ["traceparent", "tracestate"]) if (request?.headers.get(name)) headers.set(name, request.headers.get(name)!);
      const result = await (env.Email as {fetch(r:Request):Promise<Response>}).fetch(new Request("http://email.internal/v1/email", {method: "POST", headers, body: JSON.stringify(message)}));
      if (result.headers.get("x-flarestack-protocol") !== String(protocolVersion)) throw new Error("Auth/email protocol mismatch; upgrade the complete Flarestack package set.");
      if (!result.ok) throw new Error("Email delivery unavailable");
    } : undefined;
    if (requireEmailVerification && !sendEmail) throw new Error("Email verification requires an email Worker");
    const auth = yield* BetterAuth({ ...authOptions(publicOrigin, options.client, false, features, sendEmail, socialProviders), migrate: false });
    if (!globalThis.__ALCHEMY_RUNTIME__) {
      const { provisionClient } = yield* Effect.promise(() => import("./provision-client.ts"));
      yield* provisionClient(publicOrigin, options.client, features);
    }
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const path = new URL(webRequest.url).pathname;
        console.log(JSON.stringify({ message: "Auth request received", method: webRequest.method, path: telemetryPath(path) }));
        const rawAuth = yield* auth.auth;
        if (path.startsWith("/_flarestack/internal/")) return HttpServerResponse.fromWeb(yield* Effect.promise(() => internalAuth(webRequest, rawAuth, features)));
        const handle = async () => {
          if (path === "/.well-known/openid-configuration/auth" || path === "/auth/.well-known/openid-configuration") return oauthProviderOpenIdConfigMetadata(rawAuth)(webRequest);
          if (path === "/.well-known/oauth-authorization-server/auth") return oauthProviderAuthServerMetadata(rawAuth)(webRequest);
          return rawAuth.handler(webRequest);
        };
        return HttpServerResponse.fromWeb(yield* Effect.promise(() => (new URL(webRequest.url).hostname === "auth.internal" || webRequest.headers.has("x-flarestack-protocol")) ? privateRequest(webRequest, handle) : handle()));
      }),
    };
  }).pipe(Effect.provide(CloudflareD1(options.database))));
}
