import { expect, test } from "bun:test";
import { redactOutput } from "./safety.ts";
test("redacts individual OTLP header values and standalone API-key headers", () => {
  const env = { FLARESTACK_CLOUD_OTLP_HEADERS: "x-service=private-service,authorization=Bearer%20private-bearer" };
  const safe = redactOutput("private-service Bearer private-bearer Bearer%20private-bearer", env);
  expect(safe.includes("private-service")).toBe(false);
  expect(safe.includes("private-bearer")).toBe(false);
  expect(redactOutput("x-api-key: unlisted-private-key", {}).includes("unlisted-private-key")).toBe(false);
});
