import {execFile} from "node:child_process";
import {promisify} from "node:util";
const exec = promisify(execFile);
import {inboxUrl, origin} from "./local.ts";
import {test, expect} from "@playwright/test";
import {signUp, password} from "./accounts.ts";
test("verification, password recovery, profile and session revocation", async ({browser}) => {
  const context = await browser.newContext(); const page = await context.newPage();
  const email = `recovery-${crypto.randomUUID()}@example.test`;
  await signUp(page,email);
  await page.goto("/account/security");
  await page.getByLabel("Name",{exact:true}).fill("Updated profile");
  await page.getByRole("button",{name:"Update name",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  const recovery = await browser.newContext(); const other = await recovery.newPage();
  await other.goto("/account/forgot-password");
  await other.getByLabel("Email",{exact:true}).fill(email);
  await other.getByRole("button",{name:"Send reset link"}).click();
  await expect(other.getByRole("status")).toContainText("If an account exists");
  let link = "";
  await expect.poll(async () => {
    const messages = await (await fetch(inboxUrl + "/messages")).json() as {to:string;subject:string;text:string}[];
    link = messages.find(m=>m.to===email && m.subject==="Reset your password")?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
    return !!link;
  }).toBe(true);
  await other.goto(link);
  await other.getByLabel("New password",{exact:true}).fill(password+"New");
  await other.getByRole("button",{name:"Reset password",exact:true}).click();
  await expect(other.getByRole("status")).toContainText("Password changed");
  await page.goto("/todos"); await expect(page.locator("#sign-in-form")).toBeVisible();
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Continue"}).click();
  await expect(page.locator("#auth-error")).not.toBeEmpty();
  await page.getByLabel("Password",{exact:true}).fill(password+"New");
  await page.getByRole("button",{name:"Continue"}).click();
  await expect.poll(()=>new URL(page.url()).pathname).toBe("/todos");
  // Reset links are single-use.
  await other.goto(link);
  await other.getByLabel("New password",{exact:true}).fill(password+"Again");
  await other.getByRole("button",{name:"Reset password",exact:true}).click();
  await expect(other.getByRole("status")).toContainText("reset link is invalid");
  const secret = new URL(link).pathname.split("/").pop()!;
  for (const kind of ["logs", "spans"]) {
    const {stdout} = await exec("aspire", ["otel", kind, "--format", "Json", "--limit", "10000", "--non-interactive"], {maxBuffer: 16 * 1024 * 1024});
    expect(stdout.includes(secret), `Reset token leaked into ${kind}`).toBe(false);
  }
  await context.close(); await recovery.close();
});

test("password changes and self-service session controls", async ({browser}) => {
  test.setTimeout(150_000);
  const owner = await browser.newContext(); const page = await owner.newPage();
  const secondary = await browser.newContext(); const other = await secondary.newPage();
  const email = `security-${crypto.randomUUID()}@example.test`;
  try {
    await signUp(page,email);
    const loginOther = async (value: string) => {
      await other.goto("/todos");
      await other.getByLabel("Email",{exact:true}).fill(email);
      await other.getByLabel("Password",{exact:true}).fill(value);
      await other.getByRole("button",{name:"Continue"}).click();
      await expect.poll(()=>new URL(other.url()).pathname).toBe("/todos");
    };
    await loginOther(password);
    await page.goto("/account/security");
    await expect(page.locator("#sessions").getByRole("button",{name:"Revoke",exact:true})).toHaveCount(2);
    await page.getByLabel("Current password",{exact:true}).fill(password);
    await page.getByLabel("New password",{exact:true}).fill(password+"Changed");
    await page.getByRole("button",{name:"Change password",exact:true}).click();
    await expect(page.getByRole("status")).toContainText("Changes saved");
    await other.goto("/todos");await expect(other.locator("#sign-in-form")).toBeVisible();
    await loginOther(password+"Changed");
    await expect(async () => {
      await other.reload();
      await expect(other.locator(".workspace")).toHaveAttribute("data-renderer", "WebAssembly", {timeout:3000});
    }).toPass({timeout:45000, intervals:[2000]});
    await page.getByRole("button",{name:"Sign out other sessions",exact:true}).click();
    await expect(page.getByRole("status")).toContainText("Other sessions signed out");
    // An idle cached WASM page must lose its authenticated UI without navigation.
    await expect(other.getByRole("heading", {name:"Session or permissions changed"})).toBeVisible({timeout:45000});
    expect((await other.request.get("/api/todos", {maxRedirects:0})).status()).toBe(401);
    await other.goto("/todos");await expect(other.locator("#sign-in-form")).toBeVisible();
    await expect(page.locator("#sessions").getByRole("button",{name:"Revoke",exact:true})).toHaveCount(1);
    await page.locator("#sessions").getByRole("button",{name:"Revoke",exact:true}).click();
    await expect(page.locator("#sign-in-form")).toBeVisible();
  } finally {await owner.close();await secondary.close();}
});
