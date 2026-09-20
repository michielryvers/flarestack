import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt, admin } from "better-auth/plugins";

export interface OAuthClientOptions {
  clientId: string;
  clientName: string;
  /** Stable Alchemy action identity; retain it when moving an existing app. */
  resourceId: string;
}

export interface AuthFeatures {
  requireEmailVerification?: boolean;
  /** Additional plugins participate in the same automatic schema migration. */
  plugins?: BetterAuthPlugin[];
  databaseHooks?: BetterAuthOptions["databaseHooks"];
}
export type ResolvedAuthFeatures = AuthFeatures & { adminUserIds?: string[] };
export type AuthEmailSender = (message: {to: string; subject: string; text: string}, request?: Request) => Promise<void>;
export function authOptions(publicOrigin: string, client: OAuthClientOptions, provisioning = false, features: ResolvedAuthFeatures = {}, sendEmail?: AuthEmailSender, socialProviders?: BetterAuthOptions["socialProviders"]) {
  if (!client.clientId.trim() || !client.clientName.trim() || !client.resourceId.trim()) throw new Error("OAuth client id, name and resource id are required");
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin or an explicit loopback HTTP origin");
  }
  if (features.plugins?.some(p => ["admin", "jwt", "oauth-provider"].includes(p.id))) throw new Error("Core auth plugins cannot be replaced through additional plugins");
  return {
    socialProviders,
    databaseHooks: provisioning ? undefined : features.databaseHooks,
    baseURL: publicOrigin,
    advanced: { cookiePrefix: `flarestack.${encodeURIComponent(client.clientId)}` },
    basePath: "/auth",
    emailAndPassword: { enabled: true, requireEmailVerification: features.requireEmailVerification ?? false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: sendEmail ? async ({ user, url }: {user: {email: string}; url: string}, request?: Request) =>
        sendEmail({to: user.email, subject: "Reset your password", text: `Reset your password using this link:\n\n${url}\n\nIf you did not request this, ignore this message.`}, request) : undefined,
    },
    emailVerification: { sendOnSignUp: !!sendEmail, sendOnSignIn: !!sendEmail, autoSignInAfterVerification: false,
      sendVerificationEmail: sendEmail ? async ({ user, url }: {user: {email: string}; url: string}, request?: Request) =>
        sendEmail({to: user.email, subject: "Verify your email", text: `Verify your email using this link:\n\n${url}`}, request) : undefined,
    },
    plugins: [admin({ adminUserIds: features.adminUserIds }), jwt({ schema: { jwks: { modelName: "flarestackJwks" } }, jwks: { keyPairConfig: { alg: "RS256" } } }), oauthProvider({
      loginPage: "/account/sign-in", consentPage: "/account/consent",
      scopes: ["openid", "profile", "email"],
      customIdTokenClaims: ({user}) => ({role: features.adminUserIds?.includes(user.id) ? "admin" : (user.role ?? "user")}),
      grantTypes: ["authorization_code"],
      allowDynamicClientRegistration: false,
      generateClientId: provisioning ? () => client.clientId : undefined,
      cachedTrustedClients: provisioning ? undefined : new Set([client.clientId]),
      clientPrivileges: () => provisioning,
    }), ...(features.plugins ?? [])],
  };
}
