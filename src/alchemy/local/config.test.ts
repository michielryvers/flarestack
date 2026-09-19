import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalApp } from "./config.ts";

const valid = {
  stackName: "notes", infrastructureDirectory: "infra", project: "Notes.Web/Notes.Web.csproj",
  publicOrigin: "http://localhost:8999", bridgePort: 9000, buildRoot: ".",
  buildContext: ".alchemy/build", dockerfile: "Dockerfile", buildSources: ["Notes.Web", "Dockerfile"],
};
function withConfig(overrides: object, run: (path: string, directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "flarestack-config-"));
  const path = join(directory, "local.json");
  try { writeFileSync(path, JSON.stringify({ ...valid, ...overrides })); run(path, directory); }
  finally { rmSync(directory, { recursive: true }); }
}
test("resolves another app independently of working directory and Todo paths", () => {
  withConfig({}, (path, directory) => {
    const app = loadLocalApp(path);
    expect(app.infra).toBe(join(directory, "infra"));
    expect(app.projectPath).toBe(join(directory, "Notes.Web/Notes.Web.csproj"));
    expect(app.context).toBe(join(directory, ".alchemy/build"));
    expect(app.port).toBe(8999);
  });
});
test.each([
  { buildContext: "." }, { buildContext: ".alchemy" }, { buildContext: "../outside" },
  { buildSources: ["../secret"] }, { buildSources: [".alchemy"] },
  { publicOrigin: "http://public.test" }, { publicOrigin: "http://localhost/path" },
  { bridgePort: 8999 }, { bridgePort: 0 }, { beforeStart: [] }, { stackName: "notes.*" },
])("rejects unsafe or conflicting local settings %j", overrides => {
  withConfig(overrides, path => expect(() => loadLocalApp(path)).toThrow());
});

test("machine overrides change ports without replacing committed identity", () => {
  withConfig({}, (path, directory) => {
    writeFileSync(join(directory,"local.machine.json"),JSON.stringify({publicOrigin:"http://localhost:9200",bridgePort:9201,inboxPort:9202,relayPort:9203}));
    const app=loadLocalApp(path);expect(app.port).toBe(9200);expect(app.stackName).toBe("notes");
    writeFileSync(join(directory,"local.machine.json"),JSON.stringify({stackName:"different"}));
    expect(()=>loadLocalApp(path)).toThrow("Only port/origin");
  });
});
test("machine overrides cannot duplicate a listener port",()=>{
 withConfig({},(path,directory)=>{writeFileSync(join(directory,"local.machine.json"),JSON.stringify({inboxPort:9000}));expect(()=>loadLocalApp(path)).toThrow();});
});
