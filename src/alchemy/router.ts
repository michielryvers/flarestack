export function isAuthPath(path: string): boolean {
  return path === "/auth" || path.startsWith("/auth/") ||
    path === "/.well-known/openid-configuration/auth" ||
    path === "/.well-known/oauth-authorization-server/auth";
}

export function forwardedRequest(request: Request): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const websocket = headers.get("upgrade")?.toLowerCase() === "websocket";
  const connectionTokens = (headers.get("connection") ?? "").split(",").map(x => x.trim());
  for (const name of [...connectionTokens, "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-forwarded-prefix"]) {
    if (name) headers.delete(name);
  }
  if (websocket) { headers.set("upgrade", "websocket"); headers.set("connection", "Upgrade"); }
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  headers.set("x-correlation-id", crypto.randomUUID());
  return new Request(request, { headers });
}

export async function route(request: Request, auth: (request: Request) => Promise<Response>, app: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/_flarestack/health") return Response.json({ status: "ok", protocolVersion: 1 });
  if (isAuthPath(url.pathname)) return auth(request);
  return app(forwardedRequest(request));
}
