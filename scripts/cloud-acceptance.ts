import type { Browser, BrowserContext, Page } from "@playwright/test";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { redactOutput } from "../src/alchemy/deploy/safety.ts";

export class CloudAcceptanceError extends Error {}
export interface TestAccount { email: string; password: string; registered: boolean; userId?: string }
export interface Marker { id: string; title: string }

export function acceptanceArguments(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !["--app-name", "--workspace", "--stage", "--template"].includes(key) || !value || value.startsWith("--") || values[key]) {
      throw new CloudAcceptanceError("Use --app-name <unique-name> --workspace <absolute-stable-path> --stage staging --template <packed-template>.");
    }
    values[key] = value;
  }
  if (!/^[A-Za-z][A-Za-z0-9]{2,47}$/.test(values["--app-name"] ?? "")) throw new CloudAcceptanceError("Supply an explicit 3–48 character application name using ASCII letters and digits, starting with a letter.");
  if (values["--stage"] !== "staging") throw new CloudAcceptanceError("This mutating acceptance runner only targets explicitly selected staging.");
  if (!values["--workspace"] || !isAbsolute(values["--workspace"])) throw new CloudAcceptanceError("Supply an absolute stable acceptance workspace outside the repository.");
  if (!values["--template"]) throw new CloudAcceptanceError("Supply the exact packed template archive to exercise.");
  return { appName: values["--app-name"]!, workspace: values["--workspace"]!, stage: "staging" as const, template: values["--template"]! };
}

// Resolve existing ancestors too: a not-yet-created directory may be under a symlink.
export async function acceptanceWorkspace(repository: string, requested: string): Promise<string> {
  async function physical(path: string): Promise<string> {
    try { return await realpath(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return join(await physical(dirname(path)), basename(path));
    }
  }
  const root = await realpath(repository);
  const workspace = await physical(resolve(requested));
  const inside = relative(root, workspace);
  if (!inside || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new CloudAcceptanceError("Acceptance workspace must be outside the source repository.");
  }
  return workspace;
}

export function browserFailureDiagnostics(error: unknown, pageUrls: string[], secrets: Record<string, string | undefined>): string {
  // A first-line summary excludes Playwright DOM excerpts and detailed request call logs.
  const message = error instanceof Error ? error.message.split("\n")[0]! : "Browser operation failed.";
  const safe = redactOutput(message, secrets)
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { return new URL(value).pathname; } catch { return "[url]"; } })
    .replace(/[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  const paths = pageUrls.map(value => { try { return new URL(value).pathname; } catch { return "[unavailable]"; } });
  return JSON.stringify({ phase: "browser-failure", message: safe, pagePaths: paths });
}

export function migrationSql(marker: Marker): string {
  if (!/^[a-f0-9-]{32,36}$/i.test(marker.id)) throw new CloudAcceptanceError("The retained marker has an unexpected identifier format.");
  return `-- Cloud acceptance: observable, once-only change to a synthetic test row.\nUPDATE todo SET title = title || ' migrated' WHERE id = '${marker.id}';\n`;
}

export function deploymentResult(value: unknown, stackName: string): string {
  const state = value as { stackName?: string; environment?: string; status?: string; origin?: string } | null;
  if (!state || state.stackName !== stackName || state.environment !== "staging" || state.status !== "deployed" || !state.origin) {
    throw new CloudAcceptanceError("Deployment output does not match this application and staging identity.");
  }
  let url: URL;
  try { url = new URL(state.origin); } catch { throw new CloudAcceptanceError("Deployment did not produce a canonical HTTPS origin."); }
  if (url.protocol !== "https:" || url.origin !== state.origin || url.username || url.password) throw new CloudAcceptanceError("Deployment did not produce a canonical HTTPS origin.");
  return state.origin;
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CloudAcceptanceError(message);
}

export async function login(browser: Browser, origin: string, account: TestAccount, save: () => Promise<void>) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);
  if (!account.registered) {
    const response = await context.request.post("/auth/sign-up/email", {
      headers: { origin }, data: { email: account.email, password: account.password, name: "Cloud acceptance" },
    });
    if (!response.ok()) {
      // A prior attempt may have created the account before its local checkpoint was saved.
      // Recover only by authenticating with the exact private credentials already persisted.
      const recovery = await context.request.post("/auth/sign-in/email", {
        headers: { origin }, data: { email: account.email, password: account.password },
      });
      require(recovery.ok(), "Synthetic account registration or known-account recovery failed.");
    }
    account.registered = true;
    await save();
    await context.clearCookies();
  }
  let callbackSeen = false;
  page.on("request", request => { if (new URL(request.url()).pathname === "/signin-oidc") callbackSeen = true; });
  await page.goto("/account/login");
  await page.locator("#sign-in-form").waitFor();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.waitForURL(url => url.origin === origin && url.pathname === "/todos", { timeout: 120_000 });
  await page.getByRole("button", { name: "Add task", exact: true }).waitFor();
  require(callbackSeen, "The real browser login did not traverse the OIDC callback.");
  require((await context.cookies()).some(cookie => cookie.name.startsWith("Flarestack.Session.")), "The application authentication cookie was not established.");
  const sessionResponse = await context.request.get("/api/session");
  require(sessionResponse.status() === 200, "Signed application session lookup failed.");
  const session = await sessionResponse.json() as { id?: string };
  require(typeof session.id === "string" && session.id, "Signed session has no user identifier.");
  require(!account.userId || account.userId === session.id, "User identity changed across deployment.");
  account.userId = session.id;
  await save();
  return { context, page };
}

type Todo = { id: string; title: string; isComplete: boolean };
async function todos(context: BrowserContext): Promise<Todo[]> {
  const response = await context.request.get("/api/todos");
  require(response.status() === 200, "Authenticated Todo read failed.");
  require(response.headers()["cache-control"] === "no-store", "Authenticated Todo response must not be cached.");
  return await response.json();
}
async function token(context: BrowserContext) {
  const response = await context.request.get("/api/session");
  require(response.status() === 200, "Authenticated browser session lookup failed.");
  const session = await response.json() as { requestToken?: string; sid?: string };
  require(typeof session.requestToken === "string" && !session.sid, "Session response is missing antiforgery protection or exposes a private session identifier.");
  return { RequestVerificationToken: session.requestToken };
}

export async function verifyTodos(owner: BrowserContext, other: BrowserContext, marker?: Marker, migrated = false): Promise<Marker> {
  const headers = await token(owner);
  const otherHeaders = await token(other);
  require((await owner.request.post("/api/todos", { data: { title: "Missing CSRF" } })).status() === 400, "Todo mutation accepted missing antiforgery protection.");
  if (!marker) {
    const title = `Cloud acceptance retained ${crypto.randomUUID()}`;
    require((await owner.request.post("/api/todos", { headers, data: { title } })).status() === 204, "Todo create failed.");
    const created = (await todos(owner)).find(todo => todo.title === title);
    require(created, "Created Todo was not readable by its owner.");
    marker = { id: created.id, title };
  }
  const retained = (await todos(owner)).find(todo => todo.id === marker.id);
  require(retained && retained.title === marker.title + (migrated ? " migrated" : ""), "Retained Todo or once-only migration result changed across deployment.");
  require(!(await todos(other)).some(todo => todo.id === marker.id), "Another account can read the retained Todo.");
  require((await other.request.patch(`/api/todos/${marker.id}`, { headers: otherHeaders, data: { isComplete: true } })).status() === 404, "Another account can modify the retained Todo.");
  require((await other.request.delete(`/api/todos/${marker.id}`, { headers: otherHeaders })).status() === 404, "Another account can delete the retained Todo.");
  require((await owner.request.patch(`/api/todos/${marker.id}`, { headers, data: { isComplete: true } })).status() === 204, "Owner Todo completion failed.");
  require((await todos(owner)).find(todo => todo.id === marker.id)?.isComplete === true, "Owner Todo completion did not persist.");
  require((await owner.request.patch(`/api/todos/${marker.id}`, { headers, data: { isComplete: false } })).status() === 204, "Owner Todo reset failed.");
  const disposableTitle = `Cloud acceptance disposable ${crypto.randomUUID()}`;
  require((await owner.request.post("/api/todos", { headers, data: { title: disposableTitle } })).status() === 204, "Disposable Todo create failed.");
  const disposable = (await todos(owner)).find(todo => todo.title === disposableTitle);
  require(disposable, "Disposable Todo was not readable.");
  require((await owner.request.delete(`/api/todos/${disposable.id}`, { headers })).status() === 204, "Owner Todo delete failed.");
  require(!(await todos(owner)).some(todo => todo.id === disposable.id), "Deleted Todo remained visible.");
  return marker;
}

export async function logout(page: Page) {
  await page.goto("/todos");
  await page.getByRole("button", { name: /^Sign out/ }).click();
  await page.getByRole("button", { name: "Confirm logout", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/");
  require((await page.request.get("/api/todos", { maxRedirects: 0 })).status() === 401, "Logout did not invalidate application API access.");
}

export async function bootstrapAdministrator(page: Page, expectedUserId: string) {
  await page.goto("/account/settings");
  const accountId = (await page.getByTestId("account-id").textContent())?.trim();
  require(accountId && accountId === expectedUserId, "Account settings and signed session disagree on the bootstrap identity.");
  return accountId;
}

// Repair only the persisted synthetic target after an interrupted administration check.
export async function restoreTestAccount(admin: Page, account: TestAccount) {
  await admin.goto("/admin/users");
  await admin.getByRole("heading", { name: "User administration" }).waitFor();
  await admin.getByLabel("Find exact email").fill(account.email);
  await admin.getByRole("button", { name: "Search", exact: true }).click();
  const row = admin.getByRole("row").filter({ hasText: account.email });
  await row.waitFor();
  const enable = row.getByRole("button", { name: "Enable", exact: true });
  if (await enable.isVisible()) {
    await enable.click();
    await row.getByRole("cell", { name: "Active", exact: true }).waitFor();
  }
  const demote = row.getByRole("button", { name: "Make user", exact: true });
  if (await demote.isVisible()) {
    await demote.click();
    await row.getByRole("cell", { name: "user", exact: true }).waitFor();
  }
}

export async function verifyAdministration(browser: Browser, origin: string, admin: Page, target: Page, account: TestAccount, save: () => Promise<void>) {
  require((await target.request.get("/admin/users")).status() === 403, "A regular user can access administration.");
  await admin.goto("/admin/users");
  await admin.getByRole("heading", { name: "User administration" }).waitFor();
  await admin.getByLabel("Find exact email").fill(account.email);
  await admin.getByRole("button", { name: "Search", exact: true }).click();
  const row = admin.getByRole("row").filter({ hasText: account.email });
  await row.waitFor();
  await row.getByRole("button", { name: "Make admin", exact: true }).click();
  await row.getByRole("cell", { name: "admin", exact: true }).waitFor();
  await target.goto("/admin/users");
  await target.getByRole("heading", { name: "User administration" }).waitFor();
  await row.getByRole("button", { name: "Make user", exact: true }).click();
  await row.getByRole("cell", { name: "user", exact: true }).waitFor();
  require((await target.request.get("/admin/users")).status() === 403, "Demoted user's administration access remained valid.");
  await target.goto("/todos");
  await target.getByRole("button", { name: "Add task", exact: true }).waitFor();
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await row.getByRole("cell", { name: "Disabled", exact: true }).waitFor();
  await target.getByRole("button", { name: "Add task", exact: true }).waitFor({ state: "detached", timeout: 45_000 });
  require((await target.request.get("/api/todos", { maxRedirects: 0 })).status() === 401, "Disabled user's API session remained valid.");
  await row.getByRole("button", { name: "Enable", exact: true }).click();
  await row.getByRole("cell", { name: "Active", exact: true }).waitFor();
  const renewed = await login(browser, origin, account, save);
  try {
    await row.getByRole("button", { name: "Revoke sessions", exact: true }).click();
    await admin.getByRole("status").filter({ hasText: "Sessions revoked." }).waitFor();
    require((await renewed.context.request.get("/api/todos", { maxRedirects: 0 })).status() === 401, "Revoked user's API session remained valid.");
    await renewed.page.goto("/todos");
    await renewed.page.locator("#sign-in-form").waitFor();
  } finally { await renewed.context.close(); }
}
