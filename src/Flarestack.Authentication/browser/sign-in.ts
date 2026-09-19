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
      ? await auth.signUp.email({ email, password, name: String(data.get("name") || email.split("@")[0]) })
      : await auth.signIn.email({ email, password });
    if (response.error) { error.textContent = response.error.message ?? "Unable to sign in."; return; }
    // Better Auth's client follows the signed OAuth continuation automatically.
    if (!location.search) location.assign("/account/login");
  } catch { error.textContent = "Unable to reach the sign-in service. Please try again."; }
  finally { button.disabled = false; }
});
