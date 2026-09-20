import { timingSafeEqual } from "node:crypto";

/** Authenticated local OTLP relay. The relay credential never reaches the collector. */
export function relayHandler(endpoint: string, token: string, collectorHeaders: string) {
  if (!token) throw new Error("The local telemetry relay requires a credential.");
  const expected = Buffer.from(token);
  const headers = Object.fromEntries(collectorHeaders.split(",").filter(Boolean).map(pair => {
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("Invalid collector header configuration.");
    return [pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1))];
  }));
  return async (request: Request): Promise<Response> => {
    const supplied = Buffer.from(request.headers.get("x-flarestack-relay") ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return new Response(null, { status: 403 });
    }
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/v1/logs", "/v1/traces", "/v1/metrics"].includes(path)) {
      return new Response(null, { status: 404 });
    }
    return fetch(endpoint.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "application/x-protobuf", ...headers },
      body: await request.arrayBuffer(),
      signal: AbortSignal.timeout(5000),
    });
  };
}
