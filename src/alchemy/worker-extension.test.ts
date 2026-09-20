import { expect, mock, test } from "bun:test";

// Bun does not implement workerd's native base classes. The real container SDK,
// registry setters, Worker dispatch and extension factories remain under test.
mock.module("cloudflare:workers", () => ({ DurableObject: class {}, WorkerEntrypoint: class {} }));
const { createFlarestackContainer, createFlarestackWorker } = await import("./worker.ts");

test("container factory retains class identity and mandatory outbound handlers", () => {
  const custom = () => new Response("custom");
  const DotNet = createFlarestackContainer({ outboundByHost: { "api.example.com": custom } });
  expect(DotNet.name).toBe("DotNet");
  expect(Object.keys(DotNet.outboundByHost ?? {}).sort()).toEqual(["api.example.com", "auth.internal", "d1.internal", "email.internal"]);
  expect(DotNet.outboundByHost?.["api.example.com"]).toBe(custom);
  expect(() => createFlarestackContainer({ outboundByHost: { "auth.internal": custom } })).toThrow();
});
test("worker factory routes extensions and rejects duplicate/reserved paths", async () => {
  const worker = createFlarestackWorker({ routes: [{ path: "/api/status", fetch: async request => Response.json({ host: request.headers.get("x-forwarded-host") }) }] });
  const env = { Auth: { fetch: async () => new Response("auth") }, Database: {} as never, CONTAINER_ENV: {}, OTEL_EXPORTER_OTLP_ENDPOINT: "", OTEL_EXPORTER_OTLP_HEADERS: "" };
  const response = await worker.fetch(new Request("https://public.test/api/status"), env);
  expect(await response.json()).toEqual({ host: "public.test" });
  expect((await worker.fetch(new Request("https://public.test/_flarestack/internal/users"), env)).status).toBe(404);
  expect(await (await worker.fetch(new Request("https://public.test/auth"), env)).text()).toBe("auth");
  expect(() => createFlarestackWorker({ routes: [{ path: "/auth", fetch: () => new Response() }] })).toThrow();
  expect(() => createFlarestackWorker({ routes: [{ path: "/api", fetch: () => new Response() }, { path: "/api", fetch: () => new Response() }] })).toThrow("unique");
});
