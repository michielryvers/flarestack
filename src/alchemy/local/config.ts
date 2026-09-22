import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";

export interface LocalAppOptions {
  stackName: string;
  infrastructureDirectory: string;
  project: string;
  publicOrigin: string;
  bridgePort: number;
  inboxPort?: number;
  relayPort?: number;
  dashboardPort?: number;
  otlpHttpPort?: number;
  otlpGrpcPort?: number;
  resourcePort?: number;
  buildRoot: string;
  buildContext: string;
  dockerfile: string;
  buildSources: string[];
  beforeStart?: string[];
}

export function loadLocalApp(path: string, readMachineOverrides = true) {
  const options: LocalAppOptions = JSON.parse(readFileSync(path, "utf8"));
  const machine = resolve(dirname(path), "local.machine.json");
  if (readMachineOverrides && existsSync(machine)) {
    const overrides = JSON.parse(readFileSync(machine,"utf8"));
    if(Object.keys(overrides).some(key=>!["publicOrigin","bridgePort","inboxPort","relayPort","dashboardPort","otlpHttpPort","otlpGrpcPort","resourcePort"].includes(key))) throw new Error("Only port/origin machine overrides are supported");
    Object.assign(options, overrides);
  }
  for (const key of ["stackName", "infrastructureDirectory", "project", "publicOrigin", "buildRoot", "buildContext", "dockerfile"] as const)
    if (typeof options[key] !== "string" || !options[key].trim()) throw new Error(`Missing local setting: ${key}`);
  if (!/^[a-z0-9-]+$/.test(options.stackName)) throw new Error("stackName must contain lowercase letters, digits or hyphens");
  const origin = new URL(options.publicOrigin);
  if (origin.origin !== options.publicOrigin || origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname))
    throw new Error("Local publicOrigin must be a loopback HTTP origin");
  if (!Number.isInteger(options.bridgePort) || options.bridgePort < 1 || options.bridgePort > 65535 || options.bridgePort === Number(origin.port || 80))
    throw new Error("bridgePort must be a distinct valid port");
  options.inboxPort ??= 8810;
  if (!Number.isInteger(options.inboxPort) || options.inboxPort < 1 || options.inboxPort > 65535 || [options.bridgePort, Number(origin.port || 80)].includes(options.inboxPort)) throw new Error("inboxPort must be a distinct valid port");
  options.relayPort ??= 4319;
  if (!Number.isInteger(options.relayPort) || options.relayPort < 1 || options.relayPort > 65535 || [options.bridgePort, options.inboxPort, Number(origin.port || 80)].includes(options.relayPort)) throw new Error("relayPort must be a distinct valid port");
  const ports = [Number(origin.port || 80),options.bridgePort,options.inboxPort,options.relayPort,...[options.dashboardPort,options.otlpHttpPort,options.otlpGrpcPort,options.resourcePort].filter(p=>p!==undefined)];
  if(ports.some(p=>!Number.isInteger(p)||p!<1||p!>65535)||new Set(ports).size!==ports.length) throw new Error("Local ports must be valid and distinct");
  const base = dirname(resolve(path));
  const root = resolve(base, options.buildRoot);
  const context = resolve(root, options.buildContext);
  // Staging replaces this directory. Restrict it to a dedicated generated child.
  const contextRelative = relative(resolve(root, ".alchemy"), context);
  if (!contextRelative || contextRelative.startsWith("..") || isAbsolute(contextRelative)) throw new Error("buildContext must be a child of buildRoot/.alchemy");
  const safeSource = (value: unknown): value is string => typeof value === "string" && !!value && !isAbsolute(value) && !value.split(/[\\/]/).some(part => ["..", ".alchemy"].includes(part));
  if (!Array.isArray(options.buildSources) || !options.buildSources.length || !options.buildSources.every(safeSource) || !safeSource(options.dockerfile))
    throw new Error("Build paths must be relative to buildRoot and exclude generated state");
  if (options.beforeStart !== undefined && (!Array.isArray(options.beforeStart) || !options.beforeStart.length || options.beforeStart.some(v => typeof v !== "string" || !v)))
    throw new Error("beforeStart must be a nonempty command argument array");
  return { ...options, root, context, port: Number(origin.port || 80),
    infra: resolve(base, options.infrastructureDirectory), projectPath: resolve(base, options.project) };
}
