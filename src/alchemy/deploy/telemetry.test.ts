import { expect, test } from "bun:test";
import { deploymentLogs } from "./telemetry.ts";

test("deployment exporter forwards stage metadata and standard authentication headers", async () => {
  const bodies: string[] = [];
  const headers: Array<string | null> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    headers.push(request.headers.get("x-test-key"));
    bodies.push(new TextDecoder().decode(await request.arrayBuffer()));
    return new Response(new Uint8Array(), { headers: { "content-type": "application/x-protobuf" } });
  } });
  const previousEndpoint = process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT;
  const previousHeaders = process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS;
  try {
    process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT = `http://127.0.0.1:${server.port}`;
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = "x-test-key=fixture-secret";
    const logs = await deploymentLogs(new AbortController().signal, undefined, { environment: "staging" });
    logs.emit("Deployment fixture log");
    await logs.flush();
    await logs.close();
    expect(headers).toEqual(["fixture-secret"]);
    expect(bodies.join("")).toContain("deployment.environment.name");
    expect(bodies.join("")).toContain("staging");
    expect(bodies.join("")).toContain("Deployment fixture log");
  } finally {
    if (previousEndpoint === undefined) delete process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT;
    else process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT = previousEndpoint;
    if (previousHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS;
    else process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = previousHeaders;
    await server.stop(true);
  }
});

test("rejecting receiver fails flush and close without exposing receiver response", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response("private receiver response", { status: 401 });
  } });
  const previousEndpoint = process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT;
  try {
    process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT = `http://127.0.0.1:${server.port}`;
    const logs = await deploymentLogs(new AbortController().signal, undefined, { environment: "production" });
    logs.emit("Deployment fixture log");
    await expect(logs.flush()).rejects.toThrow("any applied resources were retained");
    await expect(logs.close()).rejects.toThrow("Deployment log export failed");
  } finally {
    if (previousEndpoint === undefined) delete process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT;
    else process.env.FLARESTACK_DEPLOY_OTLP_ENDPOINT = previousEndpoint;
    await server.stop(true);
  }
});
