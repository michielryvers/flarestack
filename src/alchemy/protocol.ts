// Kept in sync with version.json by scripts/check-versions.ts.
export const protocolVersion = 2;
export const releaseVersion = "0.1.0-local.2";
export const protocolHeaders = {"x-flarestack-protocol": String(protocolVersion), "x-flarestack-release": releaseVersion};
export function checkProtocol(request: Request): Response | undefined {
  if (request.headers.get("x-flarestack-protocol") !== String(protocolVersion))
    return Response.json({error:"protocol_mismatch",message:`Worker ${releaseVersion} exposes protocol ${protocolVersion}; the caller must use the matching Flarestack package set.`}, {status:426,headers:protocolHeaders});
}
export async function privateRequest(request: Request, handle: () => Promise<Response>): Promise<Response> {
  const mismatch = checkProtocol(request); if (mismatch) return mismatch;
  const response = await handle();
  const headers = new Headers(response.headers);
  for (const [name,value] of Object.entries(protocolHeaders)) headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
