import { createAuthClient } from "better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
const auth = createAuthClient({ baseURL: location.origin, basePath: "/auth", plugins: [oauthProviderClient()] });
const form = document.querySelector<HTMLFormElement>("#sign-in-form");
form?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(form);
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = document.querySelector<HTMLElement>("#auth-error")!;
  button.disabled = true; error.textContent = "";
  try {
    const email = String(data.get("email")); const password = String(data.get("password"));
    const response = data.get("register") === "on"
      ? await auth.signUp.email({ email, password, name: String(data.get("name") || email.split("@")[0]), callbackURL: location.origin + "/account/sign-in" })
      : await auth.signIn.email({ email, password });
    if (response.error) { error.textContent = response.error.message ?? "Unable to sign in."; return; }
    if (data.get("register") === "on" && !response.data?.token) { error.textContent = "Check your email to verify your account, then sign in."; return; }
    // Better Auth's client follows the signed OAuth continuation automatically.
    if (!location.search) location.assign("/account/login");
  } catch { error.textContent = "Unable to reach the sign-in service. Please try again."; }
  finally { button.disabled = false; }
});

const recovery = document.querySelector<HTMLFormElement>("#recovery-form");
recovery?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(recovery);
  const status = document.querySelector<HTMLElement>("#recovery-status")!;
  const button = recovery.querySelector<HTMLButtonElement>("button")!;
  button.disabled = true;
  try {
    const token = new URLSearchParams(location.search).get("token");
    const reset = location.pathname === "/account/reset-password";
    if (reset && !token) { status.textContent = "This reset link is invalid. Request a new one."; return; }
    const result = reset
      ? await auth.resetPassword({newPassword: String(data.get("password")), token: token!})
      : await auth.requestPasswordReset({email: String(data.get("email")), redirectTo: location.origin + "/account/reset-password"});
    status.textContent = result.error ? "Unable to complete this request. The link may have expired; request a new one." : reset
      ? "Password changed. You can now sign in." : "If an account exists for that email, you will receive a reset link.";
    if (reset && !result.error) { history.replaceState(null, "", "/account/reset-password"); recovery.reset(); }
  } catch { status.textContent = "Unable to reach the account service. Please try again."; }
  finally { button.disabled = false; }
});

const securityStatus = document.querySelector<HTMLElement>("#security-status");
for (const id of ["profile-form", "password-form"]) {
  const target = document.querySelector<HTMLFormElement>(`#${id}`);
  target?.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(target); const button = target.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    try {
      const result = id === "profile-form" ? await auth.updateUser({name:String(data.get("name"))})
        : await auth.changePassword({currentPassword:String(data.get("currentPassword")),newPassword:String(data.get("newPassword")),revokeOtherSessions:true});
      securityStatus!.textContent = result.error ? "Unable to save changes. Check your details and try again." : "Changes saved.";
      if (!result.error) target.reset();
    } catch { securityStatus!.textContent = "Account service unavailable."; }
    finally { button.disabled = false; }
  });
}
async function sessions() {
  const root = document.querySelector<HTMLElement>("#sessions");
  if (!root) return;
  try {
    const result = await auth.listSessions(); root.replaceChildren();
    if (result.error) { root.textContent = "Unable to load sessions."; return; }
    for (const session of result.data ?? []) {
      const row = document.createElement("p");
      row.textContent = `Signed in ${new Date(session.createdAt).toLocaleString()} `;
      const button = document.createElement("button"); button.textContent = "Revoke";
      button.onclick = async () => { button.disabled = true; try {
        const result = await auth.revokeSession({token:session.token});
        if (result.error) securityStatus!.textContent = "Unable to revoke session.";
        else location.assign("/account/security");
      } catch { securityStatus!.textContent = "Account service unavailable."; } finally {button.disabled=false;} };
      row.append(button); root.append(row);
    }
  } catch { root.textContent = "Account service unavailable."; }
}
void sessions();
document.querySelector("#revoke-other-sessions")?.addEventListener("click", async () => {
  try { const result = await auth.revokeOtherSessions(); securityStatus!.textContent = result.error ? "Unable to revoke sessions." : "Other sessions signed out."; await sessions(); }
  catch { securityStatus!.textContent = "Account service unavailable."; }
});
