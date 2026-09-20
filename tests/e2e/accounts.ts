import { submitSignIn } from "./sign-in.ts";
import {inboxUrl, origin} from "./local.ts";
import {expect, type Page} from "@playwright/test";
export const password = "Local-test-only!123";
export async function signUp(page: Page, email: string) {
 await page.goto("/");
 await page.getByRole("link", {name:"Open my workspace"}).click();
 await expect(page.locator("#sign-in-form")).toBeVisible();
 await page.getByLabel("Email", {exact:true}).fill(email);
 await page.getByLabel("Password", {exact:true}).fill(password);
 await page.getByLabel("Create a new account").check();
 await page.getByRole("button", {name:"Continue"}).click();
 await expect(page.locator("#auth-error")).toContainText("Check your email");
 let link = "";
 await expect.poll(async () => {
   const messages = await (await fetch(inboxUrl + "/messages")).json() as {to:string;subject:string;text:string}[];
   link = messages.find(m => m.to === email && m.subject === "Verify your email")?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
   return !!link;
 }).toBe(true);
 const preview = await page.context().newPage();
 await preview.goto(inboxUrl);
 await expect(preview.getByRole("heading", {name:"Local email inbox"})).toBeVisible();
 await expect(preview.locator("article a").first()).toHaveAttribute("href", /^http/);
 await preview.close();
 await page.goto(link);
 await page.goto("/account/login");
 await page.getByLabel("Email", {exact:true}).fill(email);
 await page.getByLabel("Password", {exact:true}).fill(password);
 await submitSignIn(page);
 await expect(page.getByRole("heading", {name:"One thing at a time."})).toBeVisible();
 await expect(page.getByText(email, {exact:true})).toBeVisible();
}
