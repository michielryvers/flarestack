import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { betterAuth } from "better-auth";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { authOptions } from "./auth-options.ts";

test("real Better Auth plugin publishes path-based issuer and PKCE metadata", async () => {
  const database = new Database(":memory:");
  try {
    const options = { ...authOptions("http://localhost:8787"), database, secret: crypto.randomUUID() + crypto.randomUUID() };
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
  expect(() => authOptions(origin)).toThrow();
});
