import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { tracedRequest } from "../tracing.ts";
import type { LocalLogs } from "./logs.ts";

// No message content enters telemetry. The local inbox is deliberately read-only,
// loopback-bound, and rejects cross-origin/Host requests (including DNS rebinding).
export function startInbox(directory: string, port: number, logs: LocalLogs) {
  const root = resolve(directory, ".alchemy/local/email");
  async function messages() {
    const files = await readdir(root).catch((e: NodeJS.ErrnoException) => { if(e.code === "ENOENT") return []; throw e; });
    return (await Promise.all(files.filter(f => /^[a-f0-9-]+\.eml$/.test(f)).map(async f => {
      const raw = await readFile(resolve(root, f), "utf8");
      const split = raw.indexOf("\r\n\r\n");
      const headers = raw.slice(0, split);
      const field = (name: string) => headers.match(new RegExp(`^${name}: (.*)$`, "mi"))?.[1]?.trim() ?? "";
      const subject = field("Subject").replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, "base64").toString("utf8"));
      return { id: f, to: field("To"), from: field("From"), subject, text: Buffer.from(raw.slice(split + 4), "base64").toString("utf8"), time: (await stat(resolve(root, f))).mtimeMs };
    }))).sort((a,b) => b.time-a.time).slice(0,100);
  }
  return Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
    const url = new URL(request.url);
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(url.host) || (request.headers.has("origin") && request.headers.get("origin") !== url.origin) || (request.headers.get("sec-fetch-site") === "cross-site" && request.headers.get("sec-fetch-dest") !== "document")) return new Response(null, {status: 403});
    return tracedRequest("flarestack.inbox", request, async () => {
      const headers = {"cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"};
      if (request.method !== "GET") return new Response(null, {status:405, headers});
      if (url.pathname === "/messages") return Response.json(await messages(), {headers});
      if (url.pathname !== "/") return new Response(null, {status:404, headers});
      logs.emit("flarestack.inbox", "Local inbox opened");
      return new Response(`<!doctype html><html><head><title>Flarestack local inbox</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px;background:#fafafa}article{background:white;padding:20px;margin:16px 0;border:1px solid #ddd;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:8px 16px}</style></head><body><h1>Local email inbox</h1><p>Messages stay on this machine. No email is delivered.</p><button onclick="refresh()">Refresh</button><main id="messages"></main><script>async function refresh(){const messages=await(await fetch('/messages')).json();const root=document.getElementById('messages');root.replaceChildren();if(!messages.length)root.textContent='No messages yet.';for(const m of messages){const card=document.createElement('article');for(const [tag,text] of [['h2',m.subject],['p','To: '+m.to+' · From: '+m.from],['pre',m.text]]){const el=document.createElement(tag);if(tag==='pre'){let start=0;for(const match of text.matchAll(/https?:\\/\\/[^\\s]+/g)){el.append(document.createTextNode(text.slice(start,match.index)));const link=document.createElement('a');link.href=match[0];link.textContent=match[0];link.target='_blank';link.rel='noopener noreferrer';el.append(link);start=match.index+match[0].length;}el.append(document.createTextNode(text.slice(start)));}else{el.textContent=text;}card.append(el);}root.append(card);}}refresh();</script></body></html>`, {headers:{...headers, "content-type":"text/html; charset=utf-8"}});
    }, { OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS });
  }});
}
