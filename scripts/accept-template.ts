import {mkdtemp,mkdir,readFile,readdir,writeFile,cp} from "node:fs/promises";
import {homedir} from "node:os";
import {resolve,join} from "node:path";
import {Database} from "bun:sqlite";
import {diagnosticLine,diagnosticSummary} from "./acceptance-diagnostics.ts";
import {stopPreparationProcess} from "./package-process.ts";
import {LocalLogs,readLines} from "../src/alchemy/local/logs.ts";
const root=resolve(import.meta.dirname,"..");
const {version}=await Bun.file(join(root,"version.json")).json();
const workspaces=process.env.FLARESTACK_ACCEPTANCE_ROOT??join(homedir(),".cache/flarestack/acceptance");
await mkdir(workspaces,{recursive:true});
const directory=await mkdtemp(join(workspaces,"run-"));
await mkdir(join(directory,"tmp"));
const app=join(directory,"application with spaces");
const mode=process.env.FLARESTACK_TEST_MODE==="Container"?"Container":"Fast";
const appName=process.env.FLARESTACK_ACCEPTANCE_APP_NAME??`Acceptance.${mode}Notes`;
const base=Number(process.env.FLARESTACK_ACCEPTANCE_PORT??9200);
const endpoint=`http://127.0.0.1:${base+9}`;
const logs=new LocalLogs(endpoint);
const env={...process.env,TMPDIR:join(directory,"tmp"),TEMP:join(directory,"tmp"),TMP:join(directory,"tmp"),DOTNET_CLI_HOME:join(directory,"dotnet-home"),BUN_INSTALL_CACHE_DIR:join(directory,"bun-cache"),Flarestack__LocalMode:mode,FLARESTACK_TEST_MODE:mode,FLARESTACK_TEST_ADMIN:"1",FLARESTACK_DASHBOARD_URL:`http://127.0.0.1:${base+4}`};
const archive=join(root,`artifacts/templates/Flarestack.Templates.${version}.nupkg`);
const old=process.env.FLARESTACK_UPGRADE_FROM;
let dashboard:Bun.Subprocess|undefined;
let phase="initialization";
const recentDiagnostics:string[]=[];
const summaryPath=process.env.FLARESTACK_ACCEPTANCE_SUMMARY??join(directory,"failure-summary.json");
async function run(args:string[],cwd=app,quiet=false){
 phase=args.slice(0,3).join(" ");
 const child=Bun.spawn(args,{cwd,env,stdout:"pipe",stderr:"pipe"});
 const capture=(line:string,stream:string)=>{
  const safe=diagnosticLine(line,env);
  if(safe){recentDiagnostics.push(safe);if(recentDiagnostics.length>60)recentDiagnostics.shift();}
  if(!quiet){console.log(line);logs.emit("flarestack.acceptance",line,stream);}
 };
 await Promise.all([readLines(child.stdout,line=>capture(line,"stdout")),readLines(child.stderr,line=>capture(line,"stderr"))]);
 if(await child.exited!==0)throw new Error(`Acceptance command failed: ${args[0]} ${args[1]}`);
}
async function install(path:string){
 const remove=Bun.spawn(["dotnet","new","uninstall","Flarestack.Templates"],{cwd:directory,env,stdout:"ignore",stderr:"ignore"});await remove.exited;
 await run(["dotnet","new","install",path],directory);
}
async function start(){await run(mode==="Container"?["bun","run","dev:container","--background","--non-interactive","--format","Json"]:["aspire","start","--non-interactive","--format","Json"],app,true);await run(["aspire","wait",mode==="Container"?"cloudflare":"app","--timeout","300","--non-interactive"]);}
async function stop(){await run(["aspire","stop","--non-interactive"],app,true);}
async function verify(administration=false){await run(["bunx","playwright","test","todo.spec.ts","accounts.spec.ts",...(administration?["admin.spec.ts"]:[])]);await run(["bun","run","verify:telemetry"]);}
async function databaseSnapshot(){
 const path=join(app,"infra/.alchemy/local/d1/cloudflare-runtime-D1DatabaseObject");
 for(const name of await readdir(path))if(name.endsWith(".sqlite")&&name!=="metadata.sqlite"){
  const db=new Database(join(path,name),{readonly:true});
  try {if(!db.query("SELECT name FROM sqlite_master WHERE name='todo'").get())continue;
   return {todos:db.query("SELECT * FROM todo ORDER BY id").all(),users:db.query('SELECT id FROM user ORDER BY id').all(),clients:db.query('SELECT clientId FROM oauthClient ORDER BY clientId').all(),upgraded:!!db.query("SELECT name FROM sqlite_master WHERE name='acceptance_upgrade'").get()};
  }finally{db.close();}
 }
 throw new Error("Application D1 database not found");
}
try {
 await mkdir(app,{recursive:true});
 dashboard=Bun.spawn(["aspire","dashboard","run","--non-interactive","--allow-anonymous","--frontend-url",`http://127.0.0.1:${base+8}`,"--otlp-http-url",endpoint,"--otlp-grpc-url",`http://127.0.0.1:${base+10}`],{cwd:directory,env,stdout:"ignore",stderr:"ignore"});
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${base+8}`)).ok)break;}catch{}if(i===59)throw new Error("Acceptance log collector did not start");await Bun.sleep(500);}
 await install(old?resolve(old):archive);
 await run(["dotnet","new","flarestack-blazor","-n",appName,"-o",app],directory);
 await run(["dotnet","restore"]);await run(["bun","install","--frozen-lockfile"]);
 await run(["dotnet","build","--no-restore"]);
 await run(["bun","run","check"]);
 await run(["bunx","playwright","install","chromium"]);
 await run(["bun","run","configure:local","--port",String(base)]);await run(["bun","run","doctor"]);
 await start();await verify(true);await stop();
 const before=await databaseSnapshot();
 if(old){
  await install(archive);const next=join(directory,"upgrade");await run(["dotnet","new","flarestack-blazor","-n",appName,"-o",next],directory);
  // Only this disposable test app is overwritten; its data and machine settings survive.
  await cp(next,app,{recursive:true});
  await run(["dotnet","restore"]);await run(["bun","install","--frozen-lockfile"]);
  await run(["bun","run","configure:local","--port",String(base)]);
 }
 await writeFile(join(app,"migrations/9999_acceptance_upgrade.sql"),"CREATE TABLE acceptance_upgrade (id TEXT PRIMARY KEY);\nINSERT INTO acceptance_upgrade VALUES ('once');\n");
 await start();await stop();
 const after=await databaseSnapshot();
 if(!after.upgraded||JSON.stringify(before.todos)!==JSON.stringify(after.todos)||JSON.stringify(before.users)!==JSON.stringify(after.users)||JSON.stringify(before.clients)!==JSON.stringify(after.clients))throw new Error("Migration/upgrade changed existing rows or duplicated provisioning");
 await start();await verify();await stop();
 console.log(`PASS: packed-template clean installation, ${mode}, restart/migration${old?" and preview upgrade":""}. Evidence retained at ${directory}`);
} catch (error) {
 // Read bounded diagnostics before stopping the dashboard; never persist raw telemetry.
 const queries=[
  ["describe","--include-hidden","--format","Json","--non-interactive"],
  ["otel","logs","--severity","Warning","--format","Json","--limit","100","--non-interactive"],
 ];
 const observations=await Promise.all(queries.map(async args=>{
  const command=Bun.spawn(["aspire",...args],{cwd:app,env,stdout:"pipe",stderr:"ignore"});
  const timeout=setTimeout(()=>command.kill(),15000);
  try {
   const output=await new Response(command.stdout).text();
   return {query:args[0],exitCode:await command.exited,...diagnosticSummary(output,env)};
  }catch{return {query:args[0],unavailable:true};}
  finally{clearTimeout(timeout);}
 }));
 await writeFile(summaryPath,JSON.stringify({mode,phase,error:diagnosticLine(error instanceof Error?error.message.split("\n")[0]!:"Acceptance failed",env)??"Acceptance failed",recentDiagnostics,observations},null,2)+"\n",{mode:0o600});
 console.error(`Sanitized acceptance failure summary: ${summaryPath}`);
 throw error;
} finally {
 try {
  await stop().catch(()=>{});
  await logs.shutdown();
 } finally {
  try { if(dashboard)await stopPreparationProcess(dashboard); }
  finally { console.log(`Acceptance workspace: ${directory}`); }
 }
}
