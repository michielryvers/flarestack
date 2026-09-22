import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { signInError, signInRoute, submitSignIn } from "../tests/e2e/sign-in.ts";

test("sign-in diagnostics classify errors and discard URL secrets and arbitrary paths", () => {
  expect(signInRoute("http://localhost/signin-oidc?code=secret&state=private")).toBe("/signin-oidc");
  expect(signInRoute("http://localhost/auth/reset-password/secret")).toBe("other");
  expect(signInError("unknown server text containing secret@example.test and private-token")).toBe("unrecognized-sign-in-error");
  expect(signInError("Invalid email or password")).toBe("invalid-login");
});

test("real browser sign-in submits once, follows completion, and fails immediately without leaking server text", async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  const original = console.log;
  const messages: string[] = [];
  console.log = (...values: unknown[]) => messages.push(values.join(" "));
  let submissions = 0;
  let reject = false;
  try {
    await page.route("http://signin.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/auth/sign-in/email") {
        submissions++;
        if (!reject) await new Promise(resolve => setTimeout(resolve, 5500));
        await route.fulfill({ status: reject ? 401 : 200, contentType: "application/json", body: "{}" });
      } else if (url.pathname === "/todos") {
        await route.fulfill({ contentType: "text/html", body: "<h1>Workspace</h1>" });
      } else {
        await route.fulfill({ contentType: "text/html", body: `<form id="sign-in-form"><button type="submit">Continue <span>→</span></button><p id="auth-error"></p></form><script>
          document.querySelector('form').onsubmit=async event=>{event.preventDefault();const response=await fetch('/auth/sign-in/email?state=secret-query',{method:'POST'});if(response.ok)location.assign('/todos');else document.querySelector('#auth-error').textContent='secret@example.test private-token';};
        </script>` });
      }
    });
    await page.goto("http://signin.test/account/sign-in?state=secret-query");
    await submitSignIn(page);
    expect(new URL(page.url()).pathname).toBe("/todos");
    expect(submissions).toBe(1);
    reject = true;
    await page.goto("http://signin.test/account/sign-in?state=secret-query");
    const started = Date.now();
    await expect(submitSignIn(page)).rejects.toThrow("unrecognized-sign-in-error");
    expect(Date.now() - started).toBeLessThan(15000);
    expect(submissions).toBe(2);
    const diagnostic = messages.join("\n");
    for (const secret of ["secret-query", "secret@example.test", "private-token"]) expect(diagnostic).not.toContain(secret);
    expect(diagnostic).toContain('"status":401');
    expect(diagnostic).toContain('"phase":"completed"');
    expect(diagnostic).toContain('"phase":"pending-after-5s"');
    expect(diagnostic).toContain('"phase":"failed"');
  } finally {
    console.log = original;
    await browser.close();
  }
}, 30000);
