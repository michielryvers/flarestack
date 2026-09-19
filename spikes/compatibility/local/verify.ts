import { strict as assert } from "node:assert";

const dashboard = process.env.FLARESTACK_DASHBOARD_URL ?? "http://127.0.0.1:18888";
const apphost = process.env.FLARESTACK_STANDALONE !== "1";
const fast = process.env.FLARESTACK_TEST_MODE !== "Container";
const dashboardArgs = apphost ? [] : ["--dashboard-url", dashboard];
const origin = process.env.PUBLIC_ORIGIN ?? "http://localhost:8787";
for (const path of ["/", "/auth/.well-known/openid-configuration"]) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, path);
  await response.arrayBuffer();
}
const required = ["flarestack.alchemy", "flarestack.worker", "flarestack.auth", ...(fast ? ["flarestack.watch"] : ["flarestack.dotnet", "flarestack.container-proxy"])];
for (let attempt = 0; attempt < 20; attempt++) {
  // Query per service so busy request logs cannot evict quiet startup logs from the result window.
  const records: { resourceName: string; message: string }[] = (await Promise.all(required.map(async service => {
    const command = Bun.spawn(["aspire", "otel", "logs", service, ...dashboardArgs, "--format", "Json", "--limit", "1000", "--non-interactive"], { stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited]);
    assert.equal(code, 0, error);
    return JSON.parse(output);
  }))).flat();
  const seen = new Set(records.map(record => record.resourceName));
  if (required.every(service => seen.has(service)) &&
      records.some(record => record.resourceName === "flarestack.worker" && record.message === "Edge request completed") &&
      records.some(record => record.resourceName === "flarestack.auth" && record.message === "Auth request received")) {
    console.log(`PASS: Aspire received OTLP logs from ${required.join(", ")}`);
    break;
  }
  if (attempt === 19) throw new Error(`Missing telemetry: ${required.filter(service => !seen.has(service)).join(", ") || "Worker request logs"}`);
  await Bun.sleep(500);
}

// Run the browser test first to generate authenticated Todo/D1 activity.
for (let attempt = 0; attempt < 20; attempt++) {
  const command = Bun.spawn(["aspire", "otel", "traces", ...dashboardArgs, "--format", "Json", "--limit", "1000", "--non-interactive"], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited]);
  assert.equal(code, 0, error);
  const traces: { traceId: string; spans: { source: string; name: string; parentSpanId?: string }[] }[] = JSON.parse(output);
  const http = traces.find(t => t.spans.some(s => s.source === "flarestack.worker") && t.spans.some(s => /^(?:todo|flarestack\.todo)(?:-|$)/.test(s.source)));
  const d1 = traces.find(t => t.spans.some(s => /^(?:todo|flarestack\.todo)(?:-|$)/.test(s.source) && s.name.startsWith("D1 ")) && t.spans.some(s => s.source === "flarestack.d1"));
  const auth = traces.find(t => t.spans.some(s => /^(?:todo|flarestack\.todo)(?:-|$)/.test(s.source)) && t.spans.some(s => s.source === "flarestack.auth-backchannel"));
  if (http && d1 && auth) {
    console.log(`PASS: connected Worker/.NET, .NET/D1, and .NET/auth traces in Aspire. D1 trace: ${dashboard}/traces/detail/${d1.traceId}`);
    break;
  }
  if (attempt === 19) throw new Error("Missing connected traces; run bun run test:e2e first to generate Todo/auth/D1 activity.");
  await Bun.sleep(500);
}
