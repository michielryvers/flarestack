import type { Page, Response } from "@playwright/test";

export function signInRoute(url: string): string {
  const pathname = new URL(url).pathname;
  return ["/auth/sign-in/email", "/auth/oauth2/authorize", "/account/login", "/account/sign-in", "/signin-oidc", "/todos"].includes(pathname) ? pathname : "other";
}

export function signInError(message: string): string {
  if (!message) return "none";
  if (/invalid email or password/i.test(message)) return "invalid-login";
  if (/email.*not verified|verify your email/i.test(message)) return "verification-required";
  if (/unable to reach the sign-in service/i.test(message)) return "service-unavailable";
  return "unrecognized-sign-in-error";
}

// One submission includes password verification and the OAuth/.NET redirect chain.
// Observe its result explicitly; do not retry authentication or widen other assertions.
export async function submitSignIn(page: Page): Promise<void> {
  const started = Date.now();
  const responses: Array<{ route: string; status: number; elapsedMs: number }> = [];
  const onResponse = (response: Response) => {
    const route = signInRoute(response.url());
    if (route !== "other" && responses.length < 30) responses.push({ route, status: response.status(), elapsedMs: Date.now() - started });
  };
  page.on("response", onResponse);
  const report = async (phase: string) => {
    const state = await page.evaluate(() => ({
      error: document.querySelector("#auth-error")?.textContent?.trim() ?? "",
      submitting: document.querySelector<HTMLButtonElement>('#sign-in-form button[type="submit"]')?.disabled ?? false,
    })).catch(() => ({ error: "", submitting: false }));
    console.log("Sign-in diagnostic " + JSON.stringify({ phase, elapsedMs: Date.now() - started, route: signInRoute(page.url()), error: signInError(state.error), submitting: state.submitting, responses }));
  };
  let checkpoint: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.locator('#sign-in-form button[type="submit"]').click();
    checkpoint = setTimeout(() => { void report("pending-after-5s"); }, 5000);
    const outcome = await page.waitForFunction(() => {
      if (location.pathname === "/todos") return { success: true, error: "" };
      const error = document.querySelector("#auth-error")?.textContent?.trim();
      return error ? { success: false, error } : false;
    }, undefined, { timeout: 15000 });
    const result = await outcome.jsonValue();
    if (!result) throw new Error("Sign-in failed: completion condition was not reached.");
    if (!result.success) throw new Error("Sign-in failed: " + signInError(result.error));
    await report("completed");
  } catch (error) {
    await report("failed");
    // Playwright errors can embed the current OAuth URL; emit only a controlled reason.
    if (error instanceof Error && error.message.startsWith("Sign-in failed: ")) throw error;
    throw new Error("Sign-in failed: no successful completion within the bounded authentication wait.");
  } finally {
    if (checkpoint) clearTimeout(checkpoint);
    page.off("response", onResponse);
  }
}
