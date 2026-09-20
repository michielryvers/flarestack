// Uses an already verified preview test account. Never prints credentials,
// cookies, authorization codes, query state, or returned HTML.
const origin=process.env.FLARESTACK_SMOKE_ORIGIN;
const accountPath=process.env.FLARESTACK_SMOKE_ACCOUNT;
if(!origin||new URL(origin).protocol!=="https:"||new URL(origin).origin!==origin||!accountPath)
  throw new Error("Set HTTPS FLARESTACK_SMOKE_ORIGIN and FLARESTACK_SMOKE_ACCOUNT to a private JSON credentials file.");
const account=await Bun.file(accountPath).json();
const cookies=new Map<string,string>();
async function request(path:string,init:RequestInit={}) {
  const url=new URL(path,origin);
  if(url.origin!==origin)throw new Error("Unexpected cross-origin auth redirect");
  const headers=new Headers(init.headers);headers.set("origin",origin!);
  headers.set("cookie",[...cookies].map(([k,v])=>`${k}=${v}`).join("; "));
  const response=await fetch(url,{...init,headers,redirect:"manual",signal:AbortSignal.timeout(60_000)});
  for(const cookie of response.headers.getSetCookie()){
    const pair=cookie.split(";",1)[0]!;const i=pair.indexOf("=");
    if(pair.slice(i+1))cookies.set(pair.slice(0,i),pair.slice(i+1));else cookies.delete(pair.slice(0,i));
  }
  return response;
}
let response=await request("/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:account.email,password:account.password})});
if(!response.ok)throw new Error(`Verified account sign-in failed (${response.status})`);
await response.arrayBuffer();
response=await request("/todos");
let callback=false, workspace=false;
for(let i=0;i<12;i++){
  const location=response.headers.get("location");
  if(location){if(new URL(location,origin).pathname==="/signin-oidc")callback=true;await response.arrayBuffer();response=await request(location);continue;}
  const html=await response.text();
  if(html.includes('name="code"')&&html.includes('name="state"')){
    const decode=(s:string)=>s.replaceAll("&amp;","&").replaceAll("&#x2B;","+").replaceAll("&#43;","+").replaceAll("&quot;",'"');
    const fields=new URLSearchParams();
    for(const match of html.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g))fields.set(match[1]!,decode(match[2]!));
    if(!fields.has("code")||!fields.has("state"))throw new Error("OIDC response fields missing");
    response=await request("/signin-oidc",{method:"POST",body:fields});callback=true;continue;
  }
  if(response.status!==200||!callback||!html.includes("Add task"))throw new Error(`Authenticated workspace failed (${response.status}, callback=${callback}, path=${new URL(response.url).pathname}, type=${response.headers.get("content-type")}, inputs=${[...html.matchAll(/name=['"]([^'"]+)['"]/g)].map(m=>m[1]).join(",")})`);
  workspace=true;console.log("PASS: verified Better Auth login, PKCE/OIDC callback, ASP.NET cookie and owned D1 workspace read.");break;
}
if(!workspace)throw new Error("Authenticated workspace not reached");
const negotiation=await request("/_blazor/negotiate?negotiateVersion=1",{method:"POST"});
if(!negotiation.ok)throw new Error(`Blazor negotiation failed (${negotiation.status})`);
const connection=await negotiation.json() as {connectionToken:string};
await new Promise<void>((resolve,reject)=>{
  const url=new URL("/_blazor",origin);url.protocol="wss:";url.searchParams.set("id",connection.connectionToken);
  const Client=WebSocket as unknown as {new(url:URL,options:Bun.WebSocketOptions):WebSocket};
  const socket=new Client(url,{headers:{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; "),origin:origin!}});
  const timeout=setTimeout(()=>{socket.close();reject(new Error("Blazor WebSocket timeout"));},20_000);
  socket.onopen=()=>socket.send('{"protocol":"blazorpack","version":1}\u001e');
  socket.onmessage=event=>{clearTimeout(timeout);socket.close();if(String(event.data).startsWith("{}"))resolve();else reject(new Error("Blazor handshake rejected"));};
  socket.onerror=()=>{clearTimeout(timeout);reject(new Error("Blazor WebSocket failed"));};
});
console.log("PASS: Worker → Container Blazor WebSocket and SignalR handshake.");
export {};
