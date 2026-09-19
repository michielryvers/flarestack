import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";

export function authOptions(publicOrigin: string, provisioning = false) {
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
      generateClientId: provisioning ? () => "todo-blazor" : undefined,
      cachedTrustedClients: provisioning ? undefined : new Set(["todo-blazor"]),
      clientPrivileges: () => provisioning,
    })],
  };
}
