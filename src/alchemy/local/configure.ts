import {readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {createServer} from "node:net";
import {loadLocalApp} from "./config.ts";
const [file,flag,value]=process.argv.slice(2);
if(!file||flag!=="--port")throw new Error("Usage: configure.ts <local.json> --port <base-port>");
const port=Number(value);
if(!Number.isInteger(port)||port<1024||port>65528)throw new Error("Choose a base port between 1024 and 65528; eight consecutive ports are used.");
const app=loadLocalApp(file);
const desired={publicOrigin:`http://localhost:${port}`,bridgePort:port+1,inboxPort:port+2,relayPort:port+3,dashboardPort:port+4,otlpHttpPort:port+5,otlpGrpcPort:port+6,resourcePort:port+7};
const path=resolve(dirname(file),"local.machine.json");
const previous=await readFile(path,"utf8").catch(()=>"");
const contents=JSON.stringify(desired,null,2)+"\n";
if(previous===contents){console.log("Already configured; no changes. The running app may stay up.");process.exit(0);}
const running=Bun.spawn(["aspire","describe","--format","Json","--non-interactive"],{cwd:app.root,stdout:"pipe",stderr:"ignore"});
const snapshot=await new Response(running.stdout).text();await running.exited;
if(snapshot.trim().startsWith("{"))throw new Error("Stop this AppHost before changing ports; existing OIDC redirects and listeners require a restart.");
const listeners:ReturnType<typeof createServer>[]=[];
try {
  // Hold all sockets until validation finishes. This detects conflicts, not a permanent reservation.
  for(let p=port;p<port+8;p++)for(const host of p===port+3?["172.17.0.1"]:["127.0.0.1","::1"]){
    const server=createServer();
    try {await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen({port:p,host,ipv6Only:true},resolve);});listeners.push(server);}
    catch(error){server.close();if((error as NodeJS.ErrnoException).code==="EADDRNOTAVAIL")continue;throw new Error(`Port ${p} on ${host} is unavailable; choose another block.`);}
  }
  await writeFile(path,contents);
} finally {for(const server of listeners)server.close();}
for(const [i,name]of ["application","private bridge","inbox","Docker OTLP relay","Aspire dashboard","OTLP HTTP","OTLP gRPC","Aspire resource service"].entries())console.log(`${name}: ${port+i}`);
console.log(`Saved ${path} (gitignored). Committed local.json is unchanged. Start with aspire run.`);
