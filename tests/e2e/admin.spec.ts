import {test,expect} from "@playwright/test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {signUp,password} from "./accounts.ts";
const exec = promisify(execFile);
test("admin bootstrap, role changes, disabling and active circuit revocation",async ({browser})=>{
 test.skip(process.env.FLARESTACK_TEST_ADMIN !== "1","Opt in: temporarily configures a bootstrap admin through the environment");
 test.setTimeout(240_000);
 const admin = await browser.newContext(); const page = await admin.newPage();
 const user = await browser.newContext(); const target = await user.newPage();
 const suffix=crypto.randomUUID(); const email=`managed-${suffix}@example.test`;
 const restart = async(adminIds?:string)=>{
   await exec("aspire",["start","--non-interactive","--format","Json"], {maxBuffer:4*1024*1024,env:{...process.env,FLARESTACK_ADMIN_USER_IDS:adminIds ?? process.env.FLARESTACK_ADMIN_USER_IDS ?? ""}});
   await exec("aspire",["wait",process.env.FLARESTACK_TEST_MODE === "Container" ? "cloudflare" : "todo","--non-interactive"]);
 };
 try {
  await signUp(page,`admin-${suffix}@example.test`);
  await page.goto("/account/settings");const id=await page.getByTestId("account-id").textContent();expect(id).toBeTruthy();
  await signUp(target,email);
  expect((await target.request.post("/_flarestack/internal/users",{data:{}})).status()).toBe(404);
  expect((await target.request.get("/admin/users")).status()).toBe(403);
  await exec("aspire",["stop","--non-interactive"]);
  await restart(id!);
  await page.goto("/admin/users"); await expect(page.getByRole("heading",{name:"User administration"})).toBeVisible();
  await page.getByLabel("Find exact email").fill(email);await page.getByRole("button",{name:"Search",exact:true}).click();
  const row=page.getByRole("row").filter({hasText:email});await expect(row).toBeVisible();
  await row.getByRole("button",{name:"Make admin",exact:true}).click();await expect(row.getByRole("cell",{name:"admin",exact:true})).toBeVisible();
  await target.goto("/admin/users");await expect(target.getByRole("heading",{name:"User administration"})).toBeVisible();
  await row.getByRole("button",{name:"Make user",exact:true}).click();await expect(row.getByRole("cell",{name:"user",exact:true})).toBeVisible();
  await target.goto("/todos");await expect(target.getByRole("button",{name:"Add task",exact:true})).toBeEnabled();
  await row.getByRole("button",{name:"Disable",exact:true}).click();await expect(row.getByRole("cell",{name:"Disabled",exact:true})).toBeVisible();
  // The open circuit must stop rendering the authenticated workspace.
  await expect(target.getByRole("button",{name:"Add task",exact:true})).toHaveCount(0,{timeout:45_000});
  await target.goto("/todos");await expect(target.locator("#sign-in-form")).toBeVisible();
  await row.getByRole("button",{name:"Enable",exact:true}).click();await expect(row.getByRole("cell",{name:"Active",exact:true})).toBeVisible();
  await target.getByLabel("Email",{exact:true}).fill(email);await target.getByLabel("Password",{exact:true}).fill(password);await target.getByRole("button",{name:"Continue"}).click();
  await expect.poll(()=>new URL(target.url()).pathname).toBe("/todos");
  await row.getByRole("button",{name:"Revoke sessions",exact:true}).click();await expect(page.getByRole("status")).toHaveText("Sessions revoked.");
  await target.goto("/todos");await expect(target.locator("#sign-in-form")).toBeVisible();
 } finally {await exec("aspire",["stop","--non-interactive"]);await restart();await admin.close();await user.close();}
});
