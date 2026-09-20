/** Runtime policy comes from deployment bindings, never from filesystem configuration. */
export function authEmailPolicy(design: { requireVerification: boolean; hasEmail: boolean }, runtime?: { Email?: unknown; FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION?: unknown }) {
  const requireVerification = runtime ? runtime.FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION : String(design.requireVerification);
  if (requireVerification !== "true" && requireVerification !== "false") throw new Error("Authentication email-verification policy binding is missing or invalid.");
  const hasEmail = runtime ? !!runtime.Email : design.hasEmail;
  if (requireVerification === "true" && !hasEmail) throw new Error("Email verification requires an email Worker");
  return { requireEmailVerification: requireVerification === "true", hasEmail };
}
