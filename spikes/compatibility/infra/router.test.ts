import { describe, expect, test } from "bun:test";
import { forwardedRequest, isAuthPath, route } from "./router.ts";

describe("public routing boundary", () => {
  test("shallow health never touches auth or the container", async () => {
    const fail = async () => { throw new Error("unexpected dispatch"); };
    const response = await route(new Request("https://public.test/_flarestack/health"), fail, fail);
    expect(response.status).toBe(200);
  });
  test.each(["/auth/sign-in/email", "/auth/.well-known/openid-configuration", "/.well-known/openid-configuration/auth", "/.well-known/oauth-authorization-server/auth"])("routes %s to auth", async path => {
    expect(isAuthPath(path)).toBe(true);
    const response = await route(new Request(`https://public.test${path}`), async () => new Response("auth"), async () => new Response("app"));
    expect(await response.text()).toBe("auth");
  });
  test.each(["/_flarestack/d1", "/v1/commands", "/d1.internal/v1/commands", "/authentic"])("%s never executes SQL", async path => {
    const response = await route(new Request(`https://public.test${path}`, { method: "POST", body: "SELECT secret" }), async () => { throw new Error("unexpected auth"); }, async request => {
      expect(await request.text()).toBe("SELECT secret");
      return new Response("not found", { status: 404 });
    });
    expect(response.status).toBe(404);
  });
  test("preserves WebSocket headers and replaces spoofed forwarding headers", () => {
    const request = forwardedRequest(new Request("https://public.test/ws?x=1", { headers: {
      upgrade: "websocket", connection: "Upgrade, X-Remove", "x-remove": "secret",
      "x-forwarded-host": "evil.test", "x-forwarded-proto": "http", forwarded: "host=evil.test",
    } }));
    expect(request.url).toBe("https://public.test/ws?x=1");
    expect(request.headers.get("upgrade")).toBe("websocket");
    expect(request.headers.get("x-forwarded-host")).toBe("public.test");
    expect(request.headers.get("x-forwarded-proto")).toBe("https");
    expect(request.headers.has("x-remove")).toBe(false);
    expect(request.headers.has("forwarded")).toBe(false);
  });
});
