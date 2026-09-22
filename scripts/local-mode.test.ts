import { expect, test } from "bun:test";
import { localCommand } from "./local-mode.ts";

test("container launcher uses environment map and supports background agent commands", () => {
  expect(localCommand("container")).toEqual({ args: ["aspire", "run"], env: { Flarestack__LocalMode: "Container" } });
  expect(localCommand("container", ["--", "--background", "--non-interactive"])).toEqual({ args: ["aspire", "start", "--non-interactive"], env: { Flarestack__LocalMode: "Container" } });
});

test("browser launchers retain additional filters", () => {
  expect(localCommand("e2e-container", ["todo.spec.ts"]).args).toEqual(["bunx", "playwright", "test", "todo.spec.ts"]);
  expect(localCommand("hot-reload").env).toEqual({ FLARESTACK_TEST_HOT_RELOAD: "1" });
  expect(() => localCommand("invalid")).toThrow("Usage:");
});
