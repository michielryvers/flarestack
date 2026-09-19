import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";

export interface OAuthClientOptions {
  clientId: string;
  clientName: string;
  /** Stable Alchemy action identity; retain it when moving an existing app. */
  resourceId: string;
}

export function authOptions(publicOrigin: string, client: OAuthClientOptions, provisioning = false) {
  if (!client.clientId.trim() || !client.clientName.trim() || !client.resourceId.trim()) throw new Error("OAuth client id, name and resource id are required");
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin or an explicit loopback HTTP origin");
  }
  return {
    baseURL: publicOrigin,
    basePath: "/auth",
    emailAndPassword: { enabled: true },
    plugins: [jwt({ schema: { jwks: { modelName: "flarestackJwks" } }, jwks: { keyPairConfig: { alg: "RS256" } } }), oauthProvider({
      loginPage: "/account/sign-in", consentPage: "/account/consent",
      scopes: ["openid", "profile", "email"],
      grantTypes: ["authorization_code"],
      allowDynamicClientRegistration: false,
      generateClientId: provisioning ? () => client.clientId : undefined,
      cachedTrustedClients: provisioning ? undefined : new Set([client.clientId]),
      clientPrivileges: () => provisioning,
    })],
  };
}
