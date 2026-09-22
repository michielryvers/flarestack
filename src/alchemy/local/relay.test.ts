import { expect, test } from "bun:test";
import { relayHandler } from "./relay.ts";

test("relay rejects missing/wrong credentials and unsupported paths", async () => {
  const handler = relayHandler("http://127.0.0.1:1", "test-relay-token", "");
  for (const token of ["", "wrong-relay-token"]) {
    expect((await handler(new Request("http://localhost/v1/logs", { method: "POST", headers: { "x-flarestack-relay": token } }))).status).toBe(403);
  }
  expect((await handler(new Request("http://localhost/private", { method: "POST", headers: { "x-flarestack-relay": "test-relay-token" } }))).status).toBe(404);
  expect(() => relayHandler("http://localhost", "", "")).toThrow("requires a credential");
});

test("relay forwards OTLP bytes with collector credentials and removes client credential", async () => {
  let received: { body: string; relay: string | null; collector: string | null; path: string } | undefined;
  const collector = Bun.serve({ port: 0, async fetch(request) {
    received = { body: await request.text(), relay: request.headers.get("x-flarestack-relay"), collector: request.headers.get("x-collector"), path: new URL(request.url).pathname };
    return new Response(null, { status: 202 });
  } });
  try {
    const handler = relayHandler(`http://127.0.0.1:${collector.port}`, "test-relay-token", "x-collector=test%20collector");
    const response = await handler(new Request("http://localhost/v1/traces", { method: "POST", headers: { "x-flarestack-relay": "test-relay-token", "content-type": "application/x-protobuf" }, body: "trace-bytes" }));
    expect(response.status).toBe(202);
    expect(received).toEqual({ body: "trace-bytes", relay: null, collector: "test collector", path: "/v1/traces" });
  } finally { await collector.stop(true); }
});
