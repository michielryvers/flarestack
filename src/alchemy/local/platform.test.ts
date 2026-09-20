import { expect, test } from "bun:test";
import { alchemyEnvironment, pathParts, relayHost, terminationCommand, workerLogService } from "./platform.ts";

test("Alchemy registry isolation is per application and does not change inherited environment", () => {
  const inherited = { XDG_STATE_HOME: "/shared/state", OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", FLARESTACK_LOCAL_BRIDGE_TOKEN: "test-only" };
  const first = alchemyEnvironment("/worktree one/app", inherited, "linux");
  const second = alchemyEnvironment("/worktree two/app", inherited, "linux");
  expect(first.XDG_STATE_HOME).toBe("/worktree one/app/.alchemy/runtime-state");
  expect(second.XDG_STATE_HOME).not.toBe(first.XDG_STATE_HOME);
  expect(first.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(inherited.OTEL_EXPORTER_OTLP_ENDPOINT);
  expect(first.FLARESTACK_LOCAL_BRIDGE_TOKEN).toBe(inherited.FLARESTACK_LOCAL_BRIDGE_TOKEN);
  expect(inherited.XDG_STATE_HOME).toBe("/shared/state");
  expect(alchemyEnvironment("C:\\worktree one\\app", inherited, "win32").XDG_STATE_HOME).toBe("C:\\worktree one\\app\\.alchemy\\runtime-state");
});

test.each(["C:\\app\\infra\\.alchemy\\log\\Auth\\worker.log", "/app/infra/.alchemy/log/Auth/worker.log"])("discovers native worker paths: %s", path => {
  expect(workerLogService(path)).toBe("flarestack.auth");
  expect(pathParts(path)).toContain(".alchemy");
});

test("only worker log files are collected", () => {
  expect(workerLogService("C:\\app\\Email\\worker.log")).toBe("flarestack.email");
  expect(workerLogService("/app/Edge/a.log")).toBe("flarestack.worker");
  expect(workerLogService("/app/LocalBridge/a.log")).toBe("flarestack.worker");
  expect(workerLogService("/app/Other/a.log")).toBeUndefined();
  expect(workerLogService("/app/Auth/a.json")).toBeUndefined();
});

test("relay selects configured address, Linux bridge, or authenticated Desktop listener", () => {
  const interfaces = { docker0: [{ address: "172.18.0.1", family: "IPv4" as const, netmask: "255.255.0.0", mac: "00:00:00:00:00:00", internal: false, cidr: "172.18.0.1/16" }] };
  expect(relayHost(undefined, "linux", interfaces)).toBe("172.18.0.1");
  expect(relayHost(undefined, "linux", {})).toBe("0.0.0.0");
  expect(relayHost(undefined, "win32", interfaces)).toBe("0.0.0.0");
  expect(relayHost("127.0.0.1", "darwin", {})).toBe("127.0.0.1");
  expect(() => relayHost("https://bad.example", "linux", {})).toThrow("local IP address");
});

test("Windows shutdown targets the watch process tree without shell parsing", () => {
  expect(terminationCommand(123, "win32")).toEqual(["taskkill", "/PID", "123", "/T", "/F"]);
  expect(terminationCommand(123, "linux")).toBeUndefined();
});
