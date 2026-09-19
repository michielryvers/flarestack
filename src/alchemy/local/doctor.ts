import {protocolVersion,releaseVersion} from "../protocol.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalApp } from "./config.ts";
if (!process.argv[2]) throw new Error("Usage: doctor.ts <local.json>");
const app = loadLocalApp(process.argv[2]);
let failed = false;
const contract=(await Bun.file(resolve(app.infra,"package.json")).json()).flarestack;
const compatible=contract?.protocol===protocolVersion&&contract?.release===releaseVersion;
console.log(`${compatible?"OK":"FAIL"}: runtime ${releaseVersion}, protocol ${protocolVersion}; infrastructure contract`);failed ||= !compatible;
for(const name of ["Flarestack.D1","Flarestack.Authentication","Flarestack.Email","Aspire.Hosting.Flarestack"]){
 const ok=existsSync(resolve(app.root,`artifacts/nuget/${name}.${releaseVersion}.nupkg`));
 console.log(`${ok?"OK":"FAIL"}: ${name} ${releaseVersion} artifact`);failed ||= !ok;
}
for (const [tool,...args] of [["bun","--version"],["dotnet","--list-sdks"],["aspire","--version"],...(process.env.Flarestack__LocalMode === "Container" ? [["docker","info","--format","{{.ServerVersion}}"]] : [])]) {
  try {
    const p=Bun.spawn([tool!,...args],{stdout:"pipe",stderr:"pipe"});
    const [output,code]=await Promise.all([new Response(p.stdout).text(),p.exited]);
    const ok=code===0 && (tool!=="dotnet" || /^10\./m.test(output));
    console.log(`${ok ? "OK" : "FAIL"}: ${tool}${ok ? " available" : " missing or unsupported"}`);failed ||= !ok;
  } catch {console.log(`FAIL: ${tool} not found on PATH`);failed=true;}
}
for(const path of [app.projectPath,resolve(app.infra,"alchemy.run.ts"),resolve(app.root,"artifacts/nuget"),resolve(app.root,"NuGet.Config")]) {
  const ok=existsSync(path);console.log(`${ok ? "OK" : "FAIL"}: ${path}`);failed ||= !ok;
}
console.log(`Local configuration valid: ${app.publicOrigin}; bridge ${app.bridgePort}; inbox ${app.inboxPort}. Docker required only in Container mode.`);
process.exitCode=failed ? 1 : 0;
