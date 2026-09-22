import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { loadLocalApp } from "../local/config.ts";

export type DeploymentEnvironment = "staging" | "production";
export interface DeploymentSettings {
  domain?: string;
  email?: { from: string; requireVerification?: boolean };
  /** Container replacement can invalidate ASP.NET cookies. D1 users/data remain durable. */
  allowEphemeralDataProtectionKeys?: boolean;
}
export class DeploymentError extends Error {}

export function deploymentEnvironment(value: unknown): DeploymentEnvironment {
  if (value !== "staging" && value !== "production") throw new DeploymentError("Choose an explicit deployment environment: staging or production.");
  return value;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new DeploymentError("Unknown deployment setting. Keep credentials in the Alchemy profile or environment, not deployment.json.");
}
export function parseDeploymentSettings(value: unknown, environment: DeploymentEnvironment): DeploymentSettings {
  if (!object(value)) throw new DeploymentError("deployment.json must be an object.");
  keys(value, ["environments"]);
  if (!object(value.environments)) throw new DeploymentError("deployment.json requires an environments object.");
  keys(value.environments, ["staging", "production"]);
  const settings = value.environments[environment];
  if (!object(settings)) throw new DeploymentError("The selected deployment environment is not configured.");
  keys(settings, ["domain", "email", "allowEphemeralDataProtectionKeys"]);
  if (settings.domain !== undefined && (typeof settings.domain !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(settings.domain) || settings.domain.endsWith(".workers.dev"))) {
    throw new DeploymentError("domain must be a canonical lowercase custom hostname; omit it to use workers.dev.");
  }
  if (settings.allowEphemeralDataProtectionKeys !== undefined && typeof settings.allowEphemeralDataProtectionKeys !== "boolean") throw new DeploymentError("allowEphemeralDataProtectionKeys must be a boolean.");
  if (environment === "production" && settings.allowEphemeralDataProtectionKeys !== true) throw new DeploymentError("Production requires allowEphemeralDataProtectionKeys: true to acknowledge that container replacement can require fresh sign-in.");
  if (settings.email !== undefined) {
    if (!object(settings.email)) throw new DeploymentError("email must contain a sender and optional verification policy.");
    keys(settings.email, ["from", "requireVerification"]);
    if (typeof settings.email.from !== "string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(settings.email.from)) throw new DeploymentError("email.from must be a valid sender address.");
    if (settings.email.requireVerification !== undefined && typeof settings.email.requireVerification !== "boolean") throw new DeploymentError("email.requireVerification must be a boolean.");
  }
  return settings as DeploymentSettings;
}
export function deploymentIdentity(stackName: string, environment: DeploymentEnvironment) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stackName)) throw new DeploymentError("Deployment stackName must contain lowercase letters, digits and single interior hyphens.");
  const identity = `${stackName}-${environment}`;
  const fullName = `${identity}-edge`;
  const workerName = fullName.length <= 54 ? fullName : `${fullName.slice(0, 41).replace(/-$/, "")}-${createHash("sha256").update(fullName).digest("hex").slice(0, 12)}`;
  return { stackName, stage: environment, identity, workerName };
}
export function loadDeployment(localPath: string, environment: DeploymentEnvironment) {
  const configurationPath = resolve(localPath);
  const local = loadLocalApp(configurationPath, false);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(resolve(dirname(configurationPath), "deployment.json"), "utf8")); }
  catch { throw new DeploymentError("Cannot read deployment.json beside the local application configuration."); }
  const settings = parseDeploymentSettings(raw, environment);
  const identity = deploymentIdentity(local.stackName, environment);
  return { local, settings, ...identity, configurationPath, context: resolve(local.root, ".alchemy", "deploy", identity.identity, "build") };
}
export function deploymentOrigin(workerName: string, subdomain: string, domain?: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) throw new DeploymentError("The Cloudflare account needs an existing valid workers.dev subdomain.");
  return `https://${domain ?? `${workerName}.${subdomain}.workers.dev`}`;
}

/** Shared by the app's single Alchemy entrypoint and its auth/email modules. */
export function loadAppEnvironment(localPath: string, clientId: string) {
  const deploying = process.env.FLARESTACK_DEPLOY === "1";
  const deployment = deploying ? loadDeployment(localPath, deploymentEnvironment(process.env.FLARESTACK_DEPLOY_ENVIRONMENT)) : undefined;
  const local = deployment?.local ?? loadLocalApp(localPath);
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? local.publicOrigin;
  if (deployment) {
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:" || origin.origin !== publicOrigin || process.env.FLARESTACK_CLOUD_BUILD_CONTEXT !== deployment.context) throw new DeploymentError("Use the deployment runner to resolve the cloud origin and build context.");
    if (deployment.settings.domain && origin.hostname !== deployment.settings.domain) throw new DeploymentError("Cloud origin does not match the configured domain.");
    if (!deployment.settings.domain && !origin.hostname.startsWith(`${deployment.workerName}.`)) throw new DeploymentError("Cloud origin does not match the deployment Worker.");
  }
  const email = deployment
    ? (deployment.settings.email ? { from: deployment.settings.email.from, requireVerification: deployment.settings.email.requireVerification ?? true } : undefined)
    : { from: process.env.FLARESTACK_EMAIL_FROM ?? "noreply@flarestack.local", requireVerification: true };
  const context = deployment?.context ?? local.context;
  const endpoint = deploying ? process.env.FLARESTACK_CLOUD_OTLP_ENDPOINT : `http://${process.env.FLARESTACK_DOCKER_HOST ?? "host.docker.internal"}:${local.relayPort}`;
  const headers = deploying ? process.env.FLARESTACK_CLOUD_OTLP_HEADERS ?? "" : process.env.FLARESTACK_LOCAL_OTLP_HEADERS ?? "";
  return {
    local, deploying, publicOrigin, email,
    domain: deployment?.settings.domain, workerName: deployment?.workerName,
    container: { context, dockerfile: resolve(context, local.dockerfile), environment: {
      ASPNETCORE_ENVIRONMENT: deploying ? "Production" : "Development",
      ...(deploying ? { Flarestack__Authentication__Authority: `${publicOrigin}/auth` } : {}),
      Flarestack__Authentication__ClientId: clientId,
      Flarestack__Authentication__BackchannelBaseAddress: "http://auth.internal",
      OTEL_SDK_DISABLED: endpoint ? "false" : "true",
      ...(endpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint } : {}),
      OTEL_EXPORTER_OTLP_HEADERS: headers, OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_BSP_SCHEDULE_DELAY: "500", OTEL_SERVICE_NAME: local.stackName,
    } },
  };
}
