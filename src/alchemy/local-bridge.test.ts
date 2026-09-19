import { expect, test } from "bun:test";
import bridge from "./local-bridge.ts";
import type { D1Database } from "@cloudflare/workers-types";
const env = { Database: { prepare() { throw new Error("Must not reach D1"); } } as unknown as D1Database, Auth: { async fetch() { throw new Error("Must not reach auth"); } }, LOCAL_BRIDGE_TOKEN: "private-test-token", OTEL_EXPORTER_OTLP_ENDPOINT:"http://127.0.0.1:4318", OTEL_EXPORTER_OTLP_HEADERS:"" };
test.each(["", "wrong-token"])("local bridge rejects missing or incorrect credentials", async token => {
 const response = await bridge.fetch(new Request("http://127.0.0.1:8789/v1/commands", {method:"POST",headers:{"x-flarestack-bridge":token},body:"{}"}), env);
 expect(response.status).toBe(403);
});
test("local bridge has no catch-all forwarding", async () => {
 expect((await bridge.fetch(new Request("http://127.0.0.1:8789/arbitrary", {headers:{"x-flarestack-bridge":env.LOCAL_BRIDGE_TOKEN}}),env)).status).toBe(404);
});
