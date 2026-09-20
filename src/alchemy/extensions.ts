import { isAuthPath } from "./router.ts";

export function validateAdditionalBindings(bindings: Record<string, unknown> = {}) {
  for (const name of Object.keys(bindings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^(database|auth|email|dotnet)$/i.test(name) || /^(FLARESTACK_|ALCHEMY_|OTEL_|LOCAL_|CONTAINER_)/i.test(name)) throw new Error("Additional bindings cannot replace framework bindings or use reserved prefixes.");
  }
}
export function containerSleepAfter(value: string | number = "30m") {
  const seconds = typeof value === "number" ? value : /^(\d+)[smh]$/.test(value) ? Number(value.slice(0, -1)) * ({ s: 1, m: 60, h: 3600 }[value.slice(-1)] ?? 0) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Container sleepAfter must be positive seconds or a positive duration such as 30s, 5m or 1h.");
  return value;
}
export function validateContainerCount(value: number = 1) {
  if (value !== 1) throw new Error("Flarestack currently supports exactly one container instance; shared session keys and multi-instance routing require a separate design.");
}
export function validateRoutePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#%\\]/.test(path) || path.includes("/../") || path.includes("/./") || path.endsWith("/..") || path.endsWith("/.") || isAuthPath(path) || path === "/_flarestack" || path.startsWith("/_flarestack/") || path === "/account" || path.startsWith("/account/") || ["/signin-oidc", "/signout-callback-oidc"].includes(path)) throw new Error("Custom routes must be exact application paths outside the reserved authentication and framework routes.");
}
export function validateOutboundHosts(handlers: Record<string, unknown> = {}) {
  for (const host of Object.keys(handlers)) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || ["email.internal", "d1.internal", "auth.internal"].includes(host)) throw new Error("Outbound handlers require lowercase hostnames and cannot replace Flarestack's internal hosts.");
  }
}
