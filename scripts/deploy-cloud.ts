import {cp,mkdir,readFile,rm} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {LocalLogs,readLines} from "../src/alchemy/local/logs.ts";

const root=resolve(import.meta.dirname,"..");
const config=await Bun.file(resolve(root,"samples/Todo/cloud.json")).json();
const origin=new URL(config.origin);
if(origin.protocol!=="https:"||origin.origin!==config.origin||!/^preview-[a-z0-9-]+$/.test(config.stage))throw new Error("Expected HTTPS origin and a disposable preview stage.");
const mode=process.argv[2]??"plan";
if(!["plan","deploy"].includes(mode))throw new Error("Usage: bun scripts/deploy-cloud.ts [plan|deploy]");
const endpoint="http://127.0.0.1:4320";
const logs=new LocalLogs(endpoint);
const dashboard=Bun.spawn(["aspire","dashboard","run","--non-interactive","--allow-anonymous","--frontend-url","http://127.0.0.1:18889","--otlp-http-url",endpoint,"--otlp-grpc-url","http://127.0.0.1:4321"],{cwd:root,stdout:"ignore",stderr:"ignore"});
let child:Bun.Subprocess|undefined;
const stop=()=>{child?.kill("SIGTERM");};process.on("SIGINT",stop);process.on("SIGTERM",stop);
try {
  for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:18889")).ok)break;}catch{}if(i===59)throw new Error("Deployment log receiver unavailable");await Bun.sleep(500);}
  const context=resolve(root,".alchemy/cloud-build");
  await rm(context,{recursive:true,force:true});await mkdir(context,{recursive:true});
  const local=JSON.parse(await readFile(resolve(root,"samples/Todo/local.json"),"utf8"));
  for(const source of local.buildSources)await cp(resolve(root,source),resolve(context,source),{recursive:true,filter:path=>!path.split("/").some(part=>["bin","obj",".alchemy","node_modules",".packages"].includes(part))&&!path.endsWith("appsettings.Development.json")&&!path.endsWith("local.machine.json")});
  // Resolve beside the infrastructure project: Effect's secret registry cannot
  // cross independently installed runtime copies in the repository and infra.
  const cli=fileURLToPath(new URL("../bin/cli.js",pathToFileURL(Bun.resolveSync("alchemy",resolve(root,"samples/Todo/infra")))));
  const args=["bun",cli,"deploy","--config","cloud.run.ts","--stage",config.stage,"--yes",...(mode==="plan"?["--dry-run"]:[])];
  child=Bun.spawn(args,{cwd:resolve(root,"samples/Todo/infra"),env:{...process.env,ALCHEMY_TELEMETRY_DISABLED:"1",FLARESTACK_DEPLOY:"1",FLARESTACK_LOCAL_MODE:"Container",PUBLIC_ORIGIN:config.origin,FLARESTACK_EMAIL_FROM:config.emailFrom,NO_COLOR:"1"},stdout:"pipe",stderr:"pipe"});
  await Promise.all([readLines(child.stdout as ReadableStream<Uint8Array>,line=>{console.log(line);logs.emit("flarestack.deploy",line);}),readLines(child.stderr as ReadableStream<Uint8Array>,line=>{console.error(line);logs.emit("flarestack.deploy",line,"stderr");})]);
  if(await child.exited!==0)throw new Error(`Cloud ${mode} failed; inspect deployment logs.`);
  console.log(`${mode} completed for ${config.stage}: ${config.origin}`);
} finally {await logs.shutdown();dashboard.kill("SIGINT");process.off("SIGINT",stop);process.off("SIGTERM",stop);}
