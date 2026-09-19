import { expect, test } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { d1Probe } from "./d1-bridge.ts";

// A partial binding deliberately fails if a rejected request ever reaches D1.
const forbiddenDatabase = new Proxy({} as D1Database, { get() { throw new Error("Database accessed"); } });
const payload = { protocolVersion: 1, operation: "query", sql: "SELECT 1 AS value", parameters: [] };
const request = (body: unknown) => new Request("http://d1.internal/v1/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
test.each([null, {}, { ...payload, protocolVersion: 2 }, { ...payload, sql: "DROP TABLE users" }, { ...payload, parameters: [1] }])("rejects invalid envelope %j without database access", async value => {
  expect((await d1Probe(request(value), forbiddenDatabase)).status).toBe(400);
});
test("limits streaming bodies", async () => {
  expect((await d1Probe(request({ text: "x".repeat(4097) }), forbiddenDatabase)).status).toBe(413);
});
test("rejects public host even if called accidentally", async () => {
  expect((await d1Probe(new Request("https://public.test/v1/commands"), forbiddenDatabase)).status).toBe(404);
});
test("sanitizes database failures", async () => {
  const response = await d1Probe(request(payload), forbiddenDatabase);
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe("D1_EXECUTION_FAILED");
  expect(body.correlationId).toBeString();
  expect(JSON.stringify(body)).not.toContain("Database accessed");
});
