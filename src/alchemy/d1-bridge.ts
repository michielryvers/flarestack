import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export async function d1Commands(request: Request, database: D1Database): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const fail = (status: number, code: string) => Response.json({ protocolVersion: 1, ok: false, correlationId, error: { code, message: "Database command failed" } }, { status });
  if (new URL(request.url).hostname !== "d1.internal" || new URL(request.url).pathname !== "/v1/commands") return fail(404, "NOT_FOUND");
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return fail(415, "CONTENT_TYPE");
  let input: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail(400, "INVALID_REQUEST");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) { await reader.cancel(); return fail(413, "REQUEST_TOO_LARGE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || input.protocolVersion !== 1) return fail(400, "PROTOCOL_VERSION");
  } catch { return fail(400, "INVALID_REQUEST"); }
  const commands = input.operation === "batch" ? input.commands : [input];
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 100) return fail(400, "COMMAND_COUNT");
  const statements: D1PreparedStatement[] = [];
  const kinds: string[] = [];
  try {
    for (const command of commands) {
      if (!command || !["query", "execute", "querySingleOrDefault"].includes(command.operation) ||
          typeof command.sql !== "string" || !command.sql.trim() || command.sql.length > 100_000 ||
          !Array.isArray(command.parameters) || command.parameters.length > 100) return fail(400, "INVALID_COMMAND");
      const parameters = command.parameters.map((value: unknown) => {
        if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
        if (typeof value === "object" && value !== null && "type" in value && value.type === "base64" && "value" in value && typeof value.value === "string") return Uint8Array.from(atob(value.value), c => c.charCodeAt(0)).buffer;
        throw new Error("Invalid parameter");
      });
      statements.push(database.prepare(command.sql).bind(...parameters)); kinds.push(command.operation);
    }
  } catch { return fail(400, "INVALID_PARAMETER"); }
  try {
    const results = input.operation === "batch" ? await database.batch(statements) : [await statements[0]!.all()];
    const mapped = results.map((result, index) => ({ rowsAffected: result.meta.changes, rows: kinds[index] === "execute" ? [] : result.results }));
    if (input.operation === "querySingleOrDefault" && mapped[0]!.rows.length > 1) return fail(409, "CARDINALITY");
    return Response.json({ protocolVersion: 1, ok: true, correlationId, ...(input.operation === "batch" ? { results: mapped } : mapped[0]) });
  } catch {
    console.error(JSON.stringify({ level: "ERROR", message: "D1 execution failed", correlationId, operation: input.operation }));
    return fail(500, "D1_EXECUTION_FAILED");
  }
}
