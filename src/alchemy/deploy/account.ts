import * as Cloudflare from "alchemy/Cloudflare";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import * as Interaction from "alchemy/Interaction";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as BunServices from "@effect/platform-bun/BunServices";
import { DeploymentError } from "./config.ts";

/** Uses Alchemy's existing credential resolver; OAuth refresh may update its private profile. */
export async function resolveCloudAccount(signal?: AbortSignal, report: (line: string) => void = () => {}) {
  const lookup = Effect.gen(function* () {
    const credentials = yield* yield* Cloudflare.CloudflareEnvironment;
    const headers = new Headers();
    if (credentials.type === "apiKey") {
      headers.set("x-auth-key", Redacted.value(credentials.apiKey));
      headers.set("x-auth-email", Redacted.value(credentials.email));
    } else headers.set("authorization", `Bearer ${Redacted.value(credentials.type === "oauth" ? credentials.accessToken : credentials.apiToken)}`);
    const result = yield* Effect.promise(async () => {
      // A GET only: do not create or rename the account-wide subdomain singleton.
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/workers/subdomain`, {
        headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new DeploymentError("Cloudflare account preflight failed. Check the selected Alchemy profile or CI token permissions.");
      const body = await response.json() as { success?: boolean; result?: { subdomain?: string } };
      if (body.success !== true || !body.result?.subdomain) throw new DeploymentError("The selected Cloudflare account needs an existing workers.dev subdomain.");
      return { subdomain: body.result.subdomain };
    });
    return result;
  }).pipe(
    Effect.provide(Cloudflare.CloudflareApiLive()),
    Effect.provide(Interaction.layerNonInteractive()),
    Effect.provideService(AuthProviders, {}),
    Effect.provide(Logger.layer([Logger.make(({ message }) => {
      for (const item of Array.isArray(message) ? message : [message]) report(typeof item === "string" ? item : "Cloudflare authentication preflight event.");
    })])),
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  );
  try { return await Effect.runPromise(lookup, { signal }); }
  catch { throw new DeploymentError("Cloudflare authentication/subdomain preflight failed. Configure the Alchemy Cloudflare profile or CI credentials and retry."); }
}
