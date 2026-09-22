import { appendFile, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { deploymentLogs } from "../src/alchemy/deploy/telemetry.ts";
import { LocalLogs, readLines } from "../src/alchemy/local/logs.ts";
import { redactOutput } from "../src/alchemy/deploy/safety.ts";
import { stopProcess } from "../src/alchemy/local/platform.ts";
import { acceptanceArguments, acceptanceWorkspace, bootstrapAdministrator, browserFailureDiagnostics, CloudAcceptanceError, deploymentResult, login, logout, migrationSql, type Marker, type TestAccount, restoreTestAccount, verifyAdministration, verifyTodos } from "./cloud-acceptance.ts";
import { smokeCloud } from "./smoke-cloud.ts";

interface State {
  schema: 1;
  appName: string;
  stage: "staging";
  templateDigest: string;
  generated: boolean;
  accounts: [TestAccount, TestAccount];
  marker?: Marker;
  migrationWritten: boolean;
  bootstrapAdminId?: string;
}

async function acceptCloud() {
  const args = acceptanceArguments(process.argv.slice(2));
  const repository = resolve(import.meta.dirname, "..");
  const workspace = await acceptanceWorkspace(repository, args.workspace);
  const archive = resolve(args.template);
  const digest = new Bun.CryptoHasher("sha256").update(await readFile(archive)).digest("hex");
  const statePath = join(workspace, "acceptance-state.json");
  let state: State;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.schema !== 1 || state.appName !== args.appName || state.stage !== args.stage || state.templateDigest !== digest) throw new CloudAcceptanceError("Workspace identity or packed template changed. Reuse its original arguments; never overwrite another cloud acceptance workspace.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entries = await readdir(workspace).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    if (entries.length) throw new CloudAcceptanceError("A new acceptance workspace must be empty.");
    const account = (): TestAccount => ({ email: `acceptance-${crypto.randomUUID()}@example.test`, password: randomBytes(32).toString("base64url") + "!aA1", registered: false });
    state = { schema: 1, appName: args.appName, stage: args.stage, templateDigest: digest, generated: false, accounts: [account(), account()], migrationWritten: false };
  }
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await chmod(workspace, 0o700);
  const save = async () => { await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); await chmod(statePath, 0o600); };
  await save();
  const app = join(workspace, "app");
  const temp = join(workspace, "tmp");
  await mkdir(temp, { recursive: true, mode: 0o700 });
  const environment = { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp, DOTNET_CLI_HOME: join(workspace, "dotnet-home"), BUN_INSTALL_CACHE_DIR: join(workspace, "bun-cache") };
  // Do not inherit a local mode or a previous deployment's target/origin.
  for (const key of ["Flarestack__LocalMode", "FLARESTACK_LOCAL_MODE", "PUBLIC_ORIGIN", "FLARESTACK_DEPLOY_ENVIRONMENT"]) delete environment[key as keyof typeof environment];
  Object.assign(environment, { FLARESTACK_ADMIN_USER_IDS: state.bootstrapAdminId ?? "" });
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let log: Awaited<ReturnType<typeof deploymentLogs>> | undefined;
  let browser: Browser | undefined;
  abort.signal.addEventListener("abort", () => { void browser?.close(); }, { once: true });
  let processLogs: LocalLogs | undefined;
  let processExportFailed = false;
  let completed = false;
  let identity = `app-${args.appName.toLowerCase()}-staging`;
  const transcript = join(workspace, "transcript.jsonl");
  const diagnostics = join(workspace, "diagnostics.log");
  await appendFile(diagnostics, "", { mode: 0o600 });
  await chmod(diagnostics, 0o600);
  let diagnosticsWrites = Promise.resolve();
  let diagnosticsFailed = false;
  async function record(phase: string, status: string) {
    // Only controlled labels enter this transcript; never command output or browser data.
    await appendFile(transcript, JSON.stringify({ at: new Date().toISOString(), identity, phase, status }) + "\n", { mode: 0o600 });
    log?.emit(`Cloud acceptance: ${phase}: ${status}`);
  }
  async function run(command: string[], phase: string, cwd = app) {
    abort.signal.throwIfAborted();
    await record(phase, "started");
    const child = Bun.spawn(command, { cwd, env: environment, stdout: "pipe", stderr: "pipe" });
    const cancel = () => { void stopProcess(child); };
    abort.signal.addEventListener("abort", cancel, { once: true });
    try {
      // Keep identical sanitized process output in OTLP and private diagnostics.
      let lines = 0;
      const collect = (line: string, stream: string) => {
        lines++;
        const secrets = { ...environment, acceptance_password_a: state.accounts[0].password, acceptance_password_b: state.accounts[1].password };
        const safe = redactOutput(line, secrets).replace(/[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
        processLogs?.emit("flarestack.cloud-acceptance", safe, stream, { "acceptance.phase": phase });
        diagnosticsWrites = diagnosticsWrites
          .then(() => appendFile(diagnostics, safe + "\n", { mode: 0o600 }))
          .catch(() => { diagnosticsFailed = true; });
      };
      await Promise.all([readLines(child.stdout, line => collect(line, "stdout")), readLines(child.stderr, line => collect(line, "stderr"))]);
      const code = await child.exited;
      await diagnosticsWrites;
      if (diagnosticsFailed) throw new CloudAcceptanceError("Private acceptance diagnostics could not be written; resources were retained.");
      log?.emit(`Cloud acceptance process ${phase}: ${lines} output lines consumed; exit ${code}.`);
      if (code !== 0) throw new CloudAcceptanceError(`Cloud acceptance phase ${phase} failed. Resources remain deployed; inspect private diagnostics at ${diagnostics}.`);
      abort.signal.throwIfAborted();
      await record(phase, "passed");
    } finally {
      abort.signal.removeEventListener("abort", cancel);
      if (child.exitCode === null) await stopProcess(child, true);
    }
  }
  try {
    console.log(`Cloud acceptance target: ${identity}. Resources and private workspace will be retained.`);
    log = await deploymentLogs(abort.signal, () => abort.abort(), { environment: "staging" });
    processLogs = new LocalLogs(log.endpoint, { environment: "staging", onExportFailure: () => { processExportFailed = true; } });
    Object.assign(environment, { FLARESTACK_DEPLOY_OTLP_ENDPOINT: log.endpoint });
    if (!state.generated) {
      await mkdir(app, { recursive: true });
      if ((await readdir(app)).length) throw new CloudAcceptanceError("Incomplete generation left files in this workspace. Review them before choosing a new empty workspace.");
      await run(["dotnet", "new", "install", archive], "install-packed-template", workspace);
      await run(["dotnet", "new", "flarestack-blazor", "-n", args.appName, "-o", app], "generate-application", workspace);
      state.generated = true;
      await save();
    }
    const local = JSON.parse(await readFile(join(app, "local.json"), "utf8"));
    if (local.stackName !== `app-${args.appName.toLowerCase()}`) throw new CloudAcceptanceError("Generated stack identity does not match the named acceptance application.");
    identity = `${local.stackName}-staging`;
    const deployment = JSON.parse(await readFile(join(app, "deployment.json"), "utf8"));
    if (!deployment.environments?.staging || deployment.environments.staging.email) throw new CloudAcceptanceError("This acceptance runner requires the generated no-email staging configuration. It never disables configured verification or sends real email.");
    await record("email-coverage", "disabled; verification, recovery and delivery not tested");
    await run(["bun", "install", "--frozen-lockfile"], "restore-bun");
    await run(["bun", "run", "check"], "check-generated-typescript");
    await run(["dotnet", "restore"], "restore-dotnet");
    const deploy = async () => {
      await run(["aspire", "deploy", "--environment", "staging", "--non-interactive"], "deploy-staging");
      const output = JSON.parse(await readFile(join(app, ".alchemy", "deploy", identity, "deployment.json"), "utf8"));
      const origin = deploymentResult(output, local.stackName);
      await smokeCloud(origin, "staging", local.stackName);
      return origin;
    };
    const migration = join(app, "migrations", "9998_cloud_acceptance.sql");
    const pendingMigration = await readFile(migration, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (pendingMigration !== undefined || state.migrationWritten) {
      if (!state.marker || pendingMigration !== migrationSql(state.marker)) throw new CloudAcceptanceError("The reserved acceptance migration changed; no deployment was attempted.");
      state.migrationWritten = true;
      await save();
    }
    let origin = await deploy();
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const verify = async (migrated: boolean) => {
      const owner = await login(browser!, origin, state.accounts[0], save);
      if (state.bootstrapAdminId && state.accounts[1].registered) await restoreTestAccount(owner.page, state.accounts[1]);
      const other = await login(browser!, origin, state.accounts[1], save);
      try {
        state.marker = await verifyTodos(owner.context, other.context, state.marker, migrated);
        await save();
        if (!state.bootstrapAdminId) {
          state.bootstrapAdminId = await bootstrapAdministrator(owner.page, state.accounts[0].userId!);
          Object.assign(environment, { FLARESTACK_ADMIN_USER_IDS: state.bootstrapAdminId });
          await save();
        } else if (migrated) {
          await verifyAdministration(browser!, origin, owner.page, other.page, state.accounts[1], save);
          await record("administration", "bootstrap, role changes, disable/enable, active workspace invalidation and session revocation passed");
        }
        await logout(owner.page);
        await record("browser-and-api", "OIDC login, signed session, CSRF, CRUD, ownership isolation and logout passed");
      } finally { await owner.context.close(); await other.context.close(); }
    };
    await verify(state.migrationWritten);
    const sql = migrationSql(state.marker!);
    if (!state.migrationWritten) {
      const existing = await readFile(migration, "utf8").catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      if (existing !== undefined && existing !== sql) throw new CloudAcceptanceError("The reserved acceptance migration already has different content.");
      if (existing === undefined) await writeFile(migration, sql, { flag: "wx" });
      state.migrationWritten = true;
      await save();
    } else if (await readFile(migration, "utf8") !== sql) throw new CloudAcceptanceError("The acceptance migration changed since its first deployment.");
    origin = await deploy();
    await verify(true);
    await record("migration", "retained row identifier/ownership and observable migration update passed");
    origin = await deploy();
    await verify(true);
    await record("redeployment", "same users and retained data; migration did not repeat");
    await record("coverage-limitations", "email, cloud trace export and cold starts not tested");
    await processLogs.flush();
    if (processExportFailed) throw new CloudAcceptanceError("Acceptance log export failed; resources were retained.");
    await log.flush();
    completed = true;
  } catch (error) {
    if (browser) {
      const secrets = { ...environment, acceptance_password_a: state.accounts[0].password, acceptance_password_b: state.accounts[1].password };
      const pages = browser.contexts().flatMap(context => context.pages().map(page => page.url()));
      await diagnosticsWrites;
      await appendFile(diagnostics, browserFailureDiagnostics(error, pages, secrets) + "\n", { mode: 0o600 });
    }
    throw error;
  } finally {
    try {
      await diagnosticsWrites;
      await browser?.close();
      await processLogs?.shutdown();
      if (processExportFailed) throw new CloudAcceptanceError("Acceptance log export failed; resources were retained.");
    } finally {
      try { await log?.close(); }
      finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", interrupt);
        console.log(`Private sanitized process diagnostics: ${diagnostics}`);
        console.log(`No automatic teardown. To permanently destroy only ${identity}, run from ${app}:`);
        console.log(`bun run destroy:cloud --environment staging --confirm ${identity}`);
        console.log("Keep the private workspace for stable redeployment; it contains test credentials and local Alchemy state.");
      }
    }
  }
  if (completed) console.log(`PASS: generated application ${identity}; cloud resources retained. Transcript: ${transcript}`);
}

if (import.meta.main) {
  try { await acceptCloud(); }
  catch (error) {
    console.error(error instanceof CloudAcceptanceError ? error.message : "Cloud acceptance failed or was interrupted. Inspect the controlled transcript; no automatic teardown was performed.");
    process.exitCode = 1;
  }
}
