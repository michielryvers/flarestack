import { strict as assert } from "node:assert";

const origin = process.argv[2] ?? "http://localhost:8787";
const appOnly = process.argv.includes("--app-only");
async function json(path: string) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, path);
  return response.json();
}
assert.equal((await json("/")).message, "Hello from .NET 10");
assert.equal((await json("/health")).status, "ok");
await new Promise<void>((resolve, reject) => {
  const url = new URL("/ws", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket timeout")); }, 30_000);
  socket.onopen = () => socket.send("flarestack-echo");
  socket.onmessage = event => {
    clearTimeout(timer);
    socket.close();
    try { assert.equal(event.data, "flarestack-echo"); resolve(); } catch (error) { reject(error); }
  };
  socket.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket failed")); };
});
if (!appOnly) {
  assert.equal((await json("/_flarestack/health")).status, "ok");
  for (const path of ["/auth/.well-known/openid-configuration", "/.well-known/openid-configuration/auth", "/.well-known/oauth-authorization-server/auth"]) {
    assert.equal((await json(path)).issuer, `${origin}/auth`);
  }
  for (const path of ["/_flarestack/d1", "/v1/commands"]) {
    assert.equal((await fetch(new URL(path, origin), { method: "POST", body: "SELECT 1", signal: AbortSignal.timeout(30_000) })).status, 404);
  }
  console.log("PASS: Worker/container HTTP, WebSocket, discovery and public SQL route isolation");
  const probe = await json("/probe/d1");
  assert.equal(probe.ok, true);
  assert.deepEqual(probe.rows, [{ value: 1 }]);
}
console.log(appOnly ? "PASS: direct container HTTP and WebSocket" : "PASS: Worker, container HTTP/WebSocket, outbound D1 and discovery");
