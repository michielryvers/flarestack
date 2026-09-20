import { readLines, parseLog } from "../src/alchemy/local/logs.ts";
import { loadLocalApp } from "../src/alchemy/local/config.ts";

// Expose only the public Worker. Obtain OTLP credentials from the running AppHost,
// refreshing after restarts; never print or persist those credentials.
const app = loadLocalApp("samples/Todo/local.json");
const child = Bun.spawn([process.env.CLOUDFLARED ?? "cloudflared", "tunnel", "--no-autoupdate", "--url", app.publicOrigin, "--loglevel", "info"], {stdout:"pipe", stderr:"pipe"});
const pending: object[] = [];
let collector: {url:string;headers:Record<string,string>} | undefined;
let flushing = false;
async function flush() {
  if(flushing || !pending.length) return;
  flushing = true;
  try {
    if(!collector) {
      const describe = Bun.spawn(["aspire","describe","--format","Json","--non-interactive"],{stdout:"pipe",stderr:"ignore"});
      const text = await new Response(describe.stdout).text();
      if(await describe.exited !== 0) return;
      const env = JSON.parse(text).resources.find((r:any)=>r.displayName === "cloudflare")?.environment;
      if(!env?.OTEL_EXPORTER_OTLP_ENDPOINT) return;
      collector = {url:env.OTEL_EXPORTER_OTLP_ENDPOINT,headers:Object.fromEntries((env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",").filter(Boolean).map((pair:string)=>{const i=pair.indexOf("=");return [pair.slice(0,i),decodeURIComponent(pair.slice(i+1))];}))};
    }
    const batch = pending.slice(0,256);
    const response = await fetch(collector.url + "/v1/logs", {method:"POST", headers:{...collector.headers,"content-type":"application/json"}, signal:AbortSignal.timeout(3000), body:JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"flarestack.tunnel"}}]},scopeLogs:[{scope:{name:"flarestack.tunnel"},logRecords:batch}]}]})});
    if(response.ok) pending.splice(0,batch.length);
    else collector = undefined;
  } catch { collector = undefined; } finally {flushing = false;}
}
const heartbeat = setInterval(() => pending.push({timeUnixNano:String(BigInt(Date.now())*1000000n),severityNumber:9,severityText:"INFO",body:{stringValue:"Local tunnel process is running"}}),30_000);
const timer = setInterval(()=>void flush(),2000);
const readers = [child.stdout,child.stderr].map((stream,index) => readLines(stream,raw => {
  const line = raw.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/g,"$1?[redacted]");
  console.log(line);
  const record = parseLog(line,index ? "stderr":"stdout");
  if(record) pending.push({timeUnixNano:String(BigInt(Date.now())*1000000n),severityNumber:record.severityNumber,severityText:record.severityText,body:{stringValue:record.body}});
  if(pending.length>4096) pending.shift();
  const url = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if(url) void Bun.write("artifacts/tunnel-origin.txt", url + "\n");
}));
for (const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,()=>child.kill("SIGINT"));
await child.exited;
await Promise.all(readers);
clearInterval(timer);
clearInterval(heartbeat);
await flush();
process.exitCode = child.exitCode ?? 1;
