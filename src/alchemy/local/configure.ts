import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadLocalApp } from "./config.ts";
const [file, flag, value] = process.argv.slice(2);
if (!file || flag !== "--port") throw new Error("Usage: configure.ts <local.json> --port <base-port>");
const port = Number(value);
if (!Number.isInteger(port) || port < 1024 || port > 65528) throw new Error("Choose a base port between 1024 and 65528; eight consecutive ports are used.");
const app = loadLocalApp(file);
const running = Bun.spawn(["aspire","describe","--format","Json","--non-interactive"],{cwd:app.root,stdout:"pipe",stderr:"ignore"});
const snapshot = await new Response(running.stdout).text(); await running.exited;
if (snapshot.trim().startsWith("{")) throw new Error("Stop this AppHost before changing local ports.");
const aspire = JSON.parse(await readFile(resolve(app.root,"aspire.config.json"),"utf8"));
const launchPath = resolve(dirname(resolve(app.root,aspire.appHost.path)),"Properties/launchSettings.json");
const launch = JSON.parse(await readFile(launchPath,"utf8"));
const local = JSON.parse(await readFile(file,"utf8"));
local.publicOrigin = `http://localhost:${port}`; local.bridgePort = port+1; local.inboxPort = port+2; local.relayPort = port+3;
for (const profile of Object.values(launch.profiles) as {applicationUrl:string;environmentVariables:Record<string,string>}[]) {
  profile.applicationUrl = `http://127.0.0.1:${port+4}`;
  Object.assign(profile.environmentVariables,{ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL:`http://127.0.0.1:${port+5}`,ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL:`http://127.0.0.1:${port+6}`,ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL:`http://127.0.0.1:${port+7}`});
}
await writeFile(file,JSON.stringify(local,null,2)+"\n");
await writeFile(launchPath,JSON.stringify(launch,null,2)+"\n");
console.log(`Local application: ${local.publicOrigin}; inbox: http://127.0.0.1:${port+2}; dashboard: http://127.0.0.1:${port+4}. Start with aspire run.`);
