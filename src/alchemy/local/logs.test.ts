import { expect, test } from "bun:test";
import { LocalLogs, parseLog, readLines } from "./logs.ts";

test("keeps structured .NET message, severity, category and exception", () => {
  const result = parseLog(JSON.stringify({ LogLevel: "Error", Category: "Spike.Web", Message: "Outbound request failed", Exception: "TimeoutException", EventId: 13 }));
  expect(result?.body).toBe("Outbound request failed");
  expect(result?.severityNumber).toBe(17);
  expect(result?.attributes["log.category"]).toBe("Spike.Web");
  expect(result?.attributes["exception.stacktrace"]).toBe("TimeoutException");
});
test("keeps structured Worker fields without inventing trace context", () => {
  const result = parseLog('{"message":"Edge request completed","status":200,"durationMs":5}');
  expect(result?.attributes.status).toBe(200);
  expect(result?.attributes.durationMs).toBe(5);
  expect(result?.attributes.traceId).toBeUndefined();
});
test("recognizes Alchemy levels and strips terminal escape sequences", () => {
  expect(parseLog("\u001b[31m[12:00] ERROR failed\u001b[0m")?.severityNumber).toBe(17);
  expect(parseLog("   ")).toBeUndefined();
});
test("line reader handles split UTF-8, line endings and final unterminated line", async () => {
  const bytes = new TextEncoder().encode("one\n€two\nlast");
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
  const lines: string[] = [];
  await readLines(stream, line => lines.push(line));
  expect(lines).toEqual(["one", "€two", "last"]);
});
test("exports actual protobuf OTLP to the configured logs receiver and flushes", async () => {
  const received: { path: string; type: string | null; size: number }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    received.push({ path: new URL(request.url).pathname, type: request.headers.get("content-type"), size: (await request.arrayBuffer()).byteLength });
    return new Response(new Uint8Array(), { headers: { "content-type": "application/x-protobuf" } });
  } });
  try {
    const logs = new LocalLogs(`http://127.0.0.1:${server.port}`);
    logs.emit("test-service", '{"message":"test exported log","level":"INFO"}');
    await logs.shutdown();
    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe("/v1/logs");
    expect(received[0]?.type).toBe("application/x-protobuf");
    expect(received[0]!.size).toBeGreaterThan(0);
  } finally { await server.stop(true); }
});
