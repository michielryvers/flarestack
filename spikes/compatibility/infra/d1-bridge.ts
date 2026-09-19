import type { D1Database } from "@cloudflare/workers-types";

// Intentionally narrow Phase 0 protocol: only the fixed SELECT probe is accepted.
// General SQL and batching belong to Phase 1 after compatibility review.
export async function d1Probe(request: Request, database: D1Database): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const error = (status: number, code: string) => Response.json({
    protocolVersion: 1, ok: false, correlationId,
    error: { code, message: "Database probe failed" },
  }, { status });
  const url = new URL(request.url);
  if (url.hostname !== "d1.internal" || url.pathname !== "/v1/commands") return error(404, "NOT_FOUND");
  if (request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return error(415, "CONTENT_TYPE");
  const reader = request.body?.getReader();
  if (!reader) return error(400, "INVALID_REQUEST");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return error(413, "REQUEST_TOO_LARGE"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value?.protocolVersion !== 1 || value.operation !== "query" || value.sql !== "SELECT 1 AS value" ||
        !Array.isArray(value.parameters) || value.parameters.length !== 0) return error(400, "INVALID_REQUEST");
  } catch { return error(400, "INVALID_REQUEST"); }
  finally { reader.releaseLock(); }
  try {
    const result = await database.prepare("SELECT 1 AS value").all();
    return Response.json({ protocolVersion: 1, ok: true, correlationId, rows: result.results, rowsAffected: 0 });
  } catch {
    console.error(JSON.stringify({ correlationId, code: "D1_EXECUTION_FAILED" }));
    return error(500, "D1_EXECUTION_FAILED");
  }
}
