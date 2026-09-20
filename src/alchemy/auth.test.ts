const client = { clientId: "custom-blazor", clientName: "Custom App", resourceId: "CustomOAuthClient" };
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { betterAuth } from "better-auth";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { authOptions } from "./auth-options.ts";

test("real Better Auth plugin publishes path-based issuer and PKCE metadata", async () => {
  const database = new Database(":memory:");
  try {
    const options = { ...authOptions("http://localhost:8787", client), database, secret: crypto.randomUUID() + crypto.randomUUID() };
    await (await getMigrations(options)).runMigrations();
    const auth = betterAuth(options);
    for (const [path, handler] of [
      ["/auth/.well-known/openid-configuration", oauthProviderOpenIdConfigMetadata(auth)],
      ["/.well-known/openid-configuration/auth", oauthProviderOpenIdConfigMetadata(auth)],
      ["/.well-known/oauth-authorization-server/auth", oauthProviderAuthServerMetadata(auth)],
    ] as const) {
      const response = await handler(new Request(`http://localhost:8787${path}`));
      expect(response.status).toBe(200);
      const metadata = await response.json();
      expect(metadata.issuer).toBe("http://localhost:8787/auth");
      expect(metadata.code_challenge_methods_supported).toContain("S256");
      expect(metadata.authorization_endpoint).toBe("http://localhost:8787/auth/oauth2/authorize");
      expect(metadata.grant_types_supported).toEqual(["authorization_code"]);
    }
  } finally { database.close(); }
});

test.each(["http://evil.test", "https://public.test/path", "https://user:pass@public.test", "https://public.test?issuer=evil"])("rejects invalid public origin %s", origin => {
  expect(() => authOptions(origin, client)).toThrow();
});

test("social providers extend authentication without changing owned OIDC policy", async () => {
  const providers = { github: { clientId: "test-client", clientSecret: "test-secret" } };
  const options = authOptions("https://public.test", client, false, {}, undefined, providers);
  expect(options.socialProviders).toBe(providers);
  expect(options.baseURL).toBe("https://public.test");
  expect(options.basePath).toBe("/auth");
  expect(options.plugins.map(plugin => plugin.id)).toEqual(["admin", "jwt", "oauth-provider"]);
  const database = new Database(":memory:");
  try {
    const setup = { ...options, database, secret: crypto.randomUUID() + crypto.randomUUID() };
    await (await getMigrations(setup)).runMigrations();
    const auth = betterAuth(setup);
    const response = await oauthProviderOpenIdConfigMetadata(auth)(new Request("https://public.test/auth/.well-known/openid-configuration"));
    const metadata = await response.json();
    expect(metadata.grant_types_supported).toEqual(["authorization_code"]);
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    expect(metadata.issuer).toBe("https://public.test/auth");
  } finally { database.close(); }
});

test("pinned Alchemy preserves redacted provider configuration across runtime bindings", async () => {
  const Config = await import("effect/Config");
  const ConfigProvider = await import("effect/ConfigProvider");
  const Effect = await import("effect/Effect");
  const Redacted = await import("effect/Redacted");
  const { packEnvValueKeepRedacted } = await import("alchemy/RuntimeContext");
  const { reifyBoundConfigProvider } = await import("alchemy/Runtime");
  const bound = packEnvValueKeepRedacted(Redacted.make("private-provider-test"));
  expect(Redacted.isRedacted(bound)).toBe(true);
  if (!Redacted.isRedacted(bound)) throw new Error("Expected secret binding");
  const environment = { GITHUB_CLIENT_SECRET: Redacted.value(bound) };
  const provider = reifyBoundConfigProvider(ConfigProvider.fromUnknown(environment), environment);
  const secret = await Effect.runPromise(Config.Redacted("GITHUB_CLIENT_SECRET").pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)));
  expect(Redacted.value(secret)).toBe("private-provider-test");
});
