import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
test("Razor edits appear through the Worker without restarting Alchemy", async ({page}) => {
 test.skip(process.env.FLARESTACK_TEST_HOT_RELOAD !== "1", "Opt in: this test temporarily edits and restores Home.razor");
 const path = resolve("samples/Todo/Todo.Web/Components/Pages/Home.razor");
 const platformPid = async () => {
   const {stdout} = await exec("aspire", ["describe", "--format", "Json", "--non-interactive"]);
   const model = JSON.parse(stdout);
   return model.resources.find((resource: {displayName: string}) => resource.displayName === "cloudflare").properties["executable.pid"];
 };
 const before = await platformPid();
 const original = await readFile(path, "utf8");
 const marker = `Hot reload ${Date.now()}`;
 try {
   await page.goto("/");
   await writeFile(path, original.replace("Clear your mind.", marker));
   await expect.poll(async () => (await (await page.request.get("/")).text()).includes(marker), {timeout:45_000}).toBe(true);
   expect(await platformPid()).toBe(before);
 } finally {
   await writeFile(path, original);
   await expect.poll(async () => (await (await page.request.get("/")).text()).includes("Clear your mind."), {timeout:45_000}).toBe(true);
 }
});
