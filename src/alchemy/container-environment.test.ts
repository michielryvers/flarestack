import { expect, test } from "bun:test";
import { containerEnvironment } from "./container-environment.ts";
test("reads cloud secret JSON and existing local environment records", () => {
  const settings = { ASPNETCORE_ENVIRONMENT: "Production", OTEL_EXPORTER_OTLP_HEADERS: "x-key=private-test" };
  expect(containerEnvironment(JSON.stringify(settings))).toEqual(settings);
  expect(containerEnvironment(settings)).toBe(settings);
});
test.each(['{"private-test":', '[]', 'null', '{"key":123}'])("invalid container binding does not disclose contents", value => {
  try { containerEnvironment(value); throw new Error("Expected invalid binding to fail"); }
  catch (error) { expect((error as Error).message).toBe("Invalid container environment binding."); }
});
