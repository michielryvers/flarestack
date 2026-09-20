import { lstat, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DeploymentError } from "./config.ts";

export function parseArguments(args: string[]) {
  const [configuration, action, ...flags] = args;
  if (!configuration || !["deploy", "plan", "destroy"].includes(action ?? "")) throw new DeploymentError("Usage: deploy/cli.ts <local.json> deploy|plan|destroy --environment staging|production [--confirm <stack-stage>]");
  const values: Record<string, string> = {};
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i], value = flags[i + 1];
    if (!flag || !["--environment", "--confirm"].includes(flag) || !value || value.startsWith("--") || values[flag] !== undefined) throw new DeploymentError("Invalid or duplicate deployment argument.");
    values[flag] = value;
  }
  if (action !== "destroy" && values["--confirm"] !== undefined) throw new DeploymentError("--confirm is only valid for destroy.");
  return { configuration, action: action as "deploy" | "plan" | "destroy", environment: values["--environment"], confirmation: values["--confirm"] };
}
export function assertDestroyConfirmation(identity: string, confirmation: string | undefined) {
  if (confirmation !== identity) throw new DeploymentError(`Destroy requires the exact confirmation: --confirm ${identity}. This permanently deletes this stage's database and resources.`);
}
export function safeBuildPath(path: string) {
  return !!path && !isAbsolute(path) && !/^[a-z]:/i.test(path) && !path.startsWith("\\") && !path.split(/[\\/]/).some(part => part === ".." || part === ".alchemy");
}
export function includeBuildPath(path: string) {
  const parts = path.toLowerCase().split(/[\\/]/);
  return !parts.some(part => ["bin", "obj", ".alchemy", "node_modules", ".packages", ".git", ".secrets", "test-results", "playwright-report"].includes(part)
    || part === ".env" || part.startsWith(".env.") || part === "local.machine.json" || part === "appsettings.development.json"
    || ["credentials.json", "secrets.json"].includes(part) || /\.(pem|key|pfx|p12|user)$/.test(part));
}
async function rejectSymlinkAncestors(root: string, target: string) {
  const path = relative(root, target);
  if (path.startsWith("..") || isAbsolute(path)) throw new DeploymentError("Build path escapes its application root.");
  let current = root;
  for (const segment of path.split(/[\\/]/)) {
    current = resolve(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new DeploymentError("Deployment build paths cannot traverse symbolic links."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
export async function stageBuild(root: string, context: string, sources: string[], dockerfile: string) {
  if (!sources.length || !sources.every(safeBuildPath) || !safeBuildPath(dockerfile)) throw new DeploymentError("Build sources and Dockerfile must be relative application paths.");
  const child = relative(resolve(root, ".alchemy", "deploy"), context);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new DeploymentError("Cloud build context must be a child of .alchemy/deploy.");
  await rejectSymlinkAncestors(root, context);
  await rm(context, { recursive: true, force: true });
  await mkdir(context, { recursive: true });
  async function copy(source: string) {
    if (!includeBuildPath(source)) return;
    await rejectSymlinkAncestors(root, resolve(root, source));
    const stats = await lstat(resolve(root, source));
    if (stats.isSymbolicLink()) throw new DeploymentError("Deployment build sources cannot contain symbolic links.");
    if (stats.isDirectory()) {
      for (const item of await readdir(resolve(root, source))) await copy(`${source}/${item}`);
    } else if (stats.isFile()) {
      const target = resolve(context, source);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(root, source), target);
    } else throw new DeploymentError("Deployment build sources must be regular files or directories.");
  }
  for (const source of sources) await copy(source);
  try { if (!(await lstat(resolve(context, dockerfile))).isFile()) throw new Error(); }
  catch { throw new DeploymentError("The Dockerfile must be included in buildSources."); }
}

export function redactOutput(line: string, environment: Record<string, string | undefined>) {
  let safe = line;
  for (const [key, value] of Object.entries(environment)) {
    if (value && /secret|token|password|credential|authorization|cookie|otlp.*headers|api[_-]?key/i.test(key)) {
      const secrets = [value];
      if (/otlp.*headers/i.test(key)) {
        for (const header of value.split(",")) {
          const separator = header.indexOf("=");
          if (separator < 0) continue;
          const secret = header.slice(separator + 1).trim();
          if (!secret) continue;
          secrets.push(secret);
          try { secrets.push(decodeURIComponent(secret)); } catch { /* The literal malformed value is still redacted. */ }
        }
      }
      for (const secret of secrets) {
        for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) safe = safe.split(form).join("[redacted]");
      }
    }
  }
  return safe
    .replace(/((?:authorization|cookie|set-cookie|x-flarestack-bridge|x-flarestack-relay|x-api-key|api-key)\s*[:=]\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/([?&](?:code|state|token|access_token|refresh_token|id_token|password|secret)=)[^\s&#"']*/gi, "$1[redacted]")
    .replace(/((?:"?(?:access_token|refresh_token|id_token|password|secret)"?)\s*[:=]\s*)"?[^\s,}"']+/gi, "$1[redacted]");
}
