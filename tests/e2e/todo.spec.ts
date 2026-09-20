import { runAspire } from "./aspire.ts";
import {inboxUrl, origin} from "./local.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { test, expect, type Page } from "@playwright/test";
import {signUp} from "./accounts.ts";
test("real OIDC, Interactive Auto CRUD, logout and two-user isolation", async ({browser}) => {
 const alice = await browser.newContext(); const page = await alice.newPage();
 const sockets: string[] = []; page.on("websocket", socket => sockets.push(socket.url()));
 const suffix = crypto.randomUUID();
 const apiWrites: string[] = []; page.on("request", request => { if (request.url().includes("/api/todos") && request.method() !== "GET") apiWrites.push(request.method()); });
 await signUp(page, `alice-${suffix}@example.test`);
 await expect(page.getByRole("button",{name:"Add task",exact:true})).toBeEnabled();
 await expect(page.locator(".workspace")).toHaveAttribute("data-renderer", "Server");
 await page.getByLabel("New task").fill("Keep this task private");
 await page.getByRole("button",{name:"Add task",exact:true}).click();
 await expect(page.getByText("Keep this task private",{exact:true})).toBeVisible();
 const checkbox = page.getByRole("checkbox",{name:"Complete Keep this task private"});
 await checkbox.check(); await expect(checkbox).toBeChecked();
 await checkbox.uncheck(); await expect(checkbox).not.toBeChecked();
 await page.reload(); await expect(page.getByText("Keep this task private",{exact:true})).toBeVisible();
 expect(sockets.some(url=>url.includes("/_blazor"))).toBe(true);
 // Auto downloads in the background; revisit until the cached runtime is selected.
 await expect(async () => {
   sockets.length = 0;
   await page.reload();
   await expect(page.locator(".workspace")).toHaveAttribute("data-renderer", "WebAssembly", {timeout: 3000});
 }).toPass({timeout: 45000, intervals: [2000]});
 await expect(page.getByRole("button",{name:"Add task",exact:true})).toBeEnabled();
 await page.getByLabel("New task").fill("Created in WebAssembly");
 await page.getByRole("button",{name:"Add task",exact:true}).click();
 await expect(page.getByText("Created in WebAssembly",{exact:true})).toBeVisible();
 await page.getByRole("checkbox",{name:"Complete Created in WebAssembly"}).check();
 await page.getByRole("button",{name:"Delete Created in WebAssembly",exact:true}).click();
 await expect(page.getByText("Created in WebAssembly",{exact:true})).toHaveCount(0);
 expect(sockets.some(url => url.includes("/_blazor"))).toBe(false);
 expect(apiWrites).toEqual(expect.arrayContaining(["POST", "PATCH", "DELETE"]));
 const privateId = await page.locator("li[data-id]").getAttribute("data-id");
 const session = await (await page.request.get("/api/session")).json();
 expect(session).not.toHaveProperty("sid");
 expect((await page.request.post("/api/todos", {data: {title:"Missing CSRF"}})).status()).toBe(400);
 expect((await page.request.post("/api/todos", {headers:{RequestVerificationToken:session.requestToken}, data:{title:" "}})).status()).toBe(400);
 const bob = await browser.newContext(); const second = await bob.newPage();
 await signUp(second, `bob-${suffix}@example.test`);
 await expect(second.getByText("Keep this task private",{exact:true})).toHaveCount(0);
 const bobSession = await (await second.request.get("/api/session")).json();
 const headers = {RequestVerificationToken:bobSession.requestToken};
 expect((await second.request.patch(`/api/todos/${privateId}`, {headers,data:{isComplete:true}})).status()).toBe(404);
 expect((await second.request.delete(`/api/todos/${privateId}`, {headers})).status()).toBe(404);
 expect((await second.request.get("/api/todos")).headers()["cache-control"]).toBe("no-store");
 await expect(second.getByRole("button",{name:"Add task",exact:true})).toBeEnabled();
 await second.getByLabel("New task").fill("Bob's task"); await second.getByRole("button",{name:"Add task",exact:true}).click();
 await expect(second.getByText("Bob's task",{exact:true})).toBeVisible();
 await page.goto("/account/settings");
 await page.getByRole("button", {name:"Send me a test email"}).click();
 await expect(page.getByRole("status")).toContainText("Email accepted");
 const inbox = inboxUrl;
 await expect.poll(async () => {
   const messages = await (await fetch(inbox + "/messages")).json() as {to:string;subject:string;text:string}[];
   return messages.some(m => m.to === `alice-${suffix}@example.test` && m.subject === "Hello from Flarestack" && m.text.includes("transport is working"));
 }).toBe(true);
 expect((await fetch(inbox + "/messages", {headers:{origin:"https://evil.example"}})).status).toBe(403);
 expect((await page.request.post("/v1/email", {data:{to:"evil@example.com",subject:"No",text:"No"}})).status()).not.toBe(202);
 await page.goto("/todos");
 // Restart only this stack's application container, never unrelated containers.
 if (process.env.FLARESTACK_TEST_MODE !== "Container") {
   await runAspire(["resource", "todo", "restart", "--non-interactive"]);
   await runAspire(["wait", "todo", "--non-interactive"]);
 } else {
   const {stdout} = await exec("docker", ["ps", "--filter", "name=^workerd-flarestack-compatibility-", "--format", "{{.ID}} {{.Names}}"]);
   const apps = stdout.trim().split("\n").filter(line => !line.endsWith("-proxy"));
   expect(apps).toHaveLength(1);
   await exec("docker", ["restart", apps[0]!.split(" ")[0]!]);
   await expect.poll(async () => { try { return (await fetch(origin + "/health")).status; } catch { return 0; } }).toBe(200);
 }
 await second.reload(); await expect(second.getByText("Bob's task",{exact:true})).toBeVisible();
 await page.reload(); await expect(page.getByText("Keep this task private",{exact:true})).toBeVisible();
 await expect(page.getByText("Bob's task",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Delete Keep this task private",exact:true}).click();
 await expect(page.getByText("Keep this task private",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Sign out"}).click();
 await page.getByRole("button",{name:"Confirm logout"}).click();
 await expect.poll(() => new URL(page.url()).pathname).toBe("/");
 expect((await page.request.get("/api/todos", {maxRedirects:0})).status()).toBe(401);
 await page.goto("/todos"); await expect(page.locator("#sign-in-form")).toBeVisible();
 await alice.close(); await bob.close();
});
