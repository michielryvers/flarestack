import { BetterAuth } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { authOptions, type OAuthClientOptions } from "./auth-options.ts";

export interface AuthWorkerOptions {
  /** Module that exports the returned Worker as default. */
  main: string;
  database: Parameters<typeof CloudflareD1>[0];
  client: OAuthClientOptions;
}

export function createAuthWorker(options: AuthWorkerOptions) {
  return Cloudflare.Worker("Auth", {
    main: options.main, workersDev: false,
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
  }, Effect.gen(function* () {
    const publicOrigin = yield* Config.String("PUBLIC_ORIGIN");
    const auth = yield* BetterAuth(authOptions(publicOrigin, options.client));
    if (!globalThis.__ALCHEMY_RUNTIME__) {
      const { provisionClient } = yield* Effect.promise(() => import("./provision-client.ts"));
      yield* provisionClient(publicOrigin, options.client);
    }
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const path = new URL(webRequest.url).pathname;
        console.log(JSON.stringify({ message: "Auth request received", method: webRequest.method, path }));
        const rawAuth = yield* auth.auth;
        if (path === "/.well-known/openid-configuration/auth" || path === "/auth/.well-known/openid-configuration") {
          return HttpServerResponse.fromWeb(yield* Effect.promise(() => oauthProviderOpenIdConfigMetadata(rawAuth)(webRequest)));
        }
        if (path === "/.well-known/oauth-authorization-server/auth") {
          return HttpServerResponse.fromWeb(yield* Effect.promise(() => oauthProviderAuthServerMetadata(rawAuth)(webRequest)));
        }
        return yield* auth.fetch.pipe(Effect.orDie);
      }),
    };
  }).pipe(Effect.provide(CloudflareD1(options.database))));
}
