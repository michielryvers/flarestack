import { expect, test } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import * as Interaction from "alchemy/Interaction";
import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

function withCloudflare<A, E>(effect: Effect.Effect<A, E, Credentials.Credentials | Cloudflare.CloudflareEnvironment>, dev: boolean) {
  return effect.pipe(
    Effect.provide(Cloudflare.CloudflareApiLive()),
    Effect.provideService(AlchemyContext, { dev, dotAlchemy: "/unused", adopt: false }),
    Effect.provideService(AuthProviders, {}),
    Effect.provide(Interaction.layerNonInteractive()),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ CI: "true" })),
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  );
}

test("local SDK account namespace resolves without credentials while API credentials fail closed", async () => {
  const accountId = await Effect.runPromise(withCloudflare(Effect.gen(function* () {
    return (yield* yield* Cloudflare.CloudflareEnvironment).accountId;
  }), true));
  expect(accountId).toBe("00000000000000000000000000000000");
  await expect(Effect.runPromise(withCloudflare(Effect.gen(function* () {
    return yield* yield* Credentials.Credentials;
  }), true))).rejects.toThrow("API access is unavailable in Flarestack local development");
});

test("cloud deployment still rejects missing credentials", async () => {
  await expect(Effect.runPromise(withCloudflare(Effect.gen(function* () {
    return yield* yield* Cloudflare.CloudflareEnvironment;
  }), false))).rejects.toThrow("CLOUDFLARE_ACCOUNT_ID");
});
