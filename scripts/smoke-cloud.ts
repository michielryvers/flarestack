// Read-only preflight for a separately deployed disposable stage. Never deploys.
const origin=process.env.FLARESTACK_SMOKE_ORIGIN;
const stage=process.env.FLARESTACK_SMOKE_STAGE;
if(!origin||!stage||!/^preview-[a-z0-9-]+$/.test(stage))throw new Error("Set FLARESTACK_SMOKE_ORIGIN and a disposable FLARESTACK_SMOKE_STAGE=preview-... explicitly.");
const url=new URL(origin);
if(url.protocol!=="https:"||url.origin!==origin)throw new Error("Cloud smoke requires an HTTPS origin without a path.");
const discovery=await fetch(`${origin}/auth/.well-known/openid-configuration`,{redirect:"error"});
if(!discovery.ok)throw new Error("OIDC discovery failed");
const metadata=await discovery.json() as Record<string,unknown>;
if(metadata.issuer!==`${origin}/auth`)throw new Error("Public OIDC issuer mismatch");
for(const key of ["authorization_endpoint","token_endpoint","jwks_uri"]){
 if(typeof metadata[key]!=="string"||new URL(metadata[key] as string).origin!==origin)throw new Error(`Unexpected ${key}`);
}
for(const path of ["/_flarestack/health","/_flarestack/ready","/health"])
 if(!(await fetch(origin+path,{redirect:"error"})).ok)throw new Error(`Health check failed: ${path}`);
for(const path of ["/_flarestack/internal/users","/_flarestack/d1"])
 if((await fetch(origin+path,{method:"POST",redirect:"manual"})).status!==404)throw new Error(`Private route exposed: ${path}`);
console.log(`PASS: ${stage} HTTPS discovery, health and private-route boundary. This does not certify the full cloud vertical slice.`);

export {};
