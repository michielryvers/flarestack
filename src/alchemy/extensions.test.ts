import { expect, test } from "bun:test";
import { containerSleepAfter, validateAdditionalBindings, validateContainerCount, validateOutboundHosts, validateRoutePath } from "./extensions.ts";
import { route } from "./router.ts";

test("container defaults and supported duration formats match the pinned SDK", () => {
  expect(containerSleepAfter()).toBe("30m");
  for (const value of [30, 0.5, "30s", "5m", "1h"]) expect(containerSleepAfter(value)).toBe(value);
  for (const value of [0, -1, NaN, Infinity, "0s", "forever", "1d"]) expect(() => containerSleepAfter(value)).toThrow();
  expect(() => validateContainerCount()).not.toThrow();
  for (const value of [0, 2, NaN]) expect(() => validateContainerCount(value)).toThrow("exactly one");
});
test("additional bindings cannot replace infrastructure or telemetry ownership", () => {
  expect(() => validateAdditionalBindings({ CACHE: {}, GREETING: "hello" })).not.toThrow();
  for (const name of ["Database", "Auth", "Email", "DotNet", "OTEL_EXPORTER_OTLP_HEADERS", "LOCAL_ORIGIN", "CONTAINER_ENV", "CONTAINER_SLEEP_AFTER", "ALCHEMY_STAGE", "FLARESTACK_SECRET"]) expect(() => validateAdditionalBindings({ [name]: "replacement" })).toThrow();
});
test("outbound additions preserve all core service hosts", () => {
  expect(() => validateOutboundHosts({ "api.example.com": () => {} })).not.toThrow();
  for (const name of ["auth.internal", "email.internal", "d1.internal", "Auth.internal", "auth.internal.", "https://api.example.com", "api.example.com:443"]) expect(() => validateOutboundHosts({ [name]: () => {} })).toThrow();
});
test.each(["/auth", "/auth/sign-in/email", "/.well-known/openid-configuration/auth", "/_flarestack/internal/users", "/_flarestack/d1", "/account/login", "/signin-oidc", "/signout-callback-oidc", "//evil.test", "/api/../auth", "/api/%2e%2e/auth"])("rejects custom interception of reserved/ambiguous path %s", path => {
  expect(() => validateRoutePath(path)).toThrow();
});
test("custom route dispatch runs after framework boundaries and before app", async () => {
  let customCalls = 0, appCalls = 0, authCalls = 0;
  const auth = async () => { authCalls++; return new Response("auth"); };
  const app = async () => { appCalls++; return new Response("app"); };
  const custom = async (request: Request) => {
    customCalls++;
    expect(request.headers.get("x-forwarded-host")).toBe("public.test");
    return new URL(request.url).pathname === "/api/status" ? new Response("custom") : undefined;
  };
  const run = (path: string) => route(new Request(`https://public.test${path}`, { headers: { "x-forwarded-host": "evil.test" } }), auth, app, custom);
  expect((await run("/_flarestack/internal/users")).status).toBe(404);
  expect((await run("/_flarestack/d1")).status).toBe(404);
  expect((await run("/_flarestack/health")).status).toBe(200);
  expect(await (await run("/auth/sign-in/email")).text()).toBe("auth");
  expect(customCalls).toBe(0);
  expect(await (await run("/api/status")).text()).toBe("custom");
  expect(appCalls).toBe(0);
  expect(await (await run("/app")).text()).toBe("app");
  expect([customCalls, appCalls, authCalls]).toEqual([2, 1, 1]);
});
