import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";

const severities: Record<string, number> = { TRACE: 1, DEBUG: 5, INFO: 9, INFORMATION: 9, WARN: 13, WARNING: 13, ERROR: 17, FAIL: 17, CRITICAL: 21, FATAL: 21 };
export function parseLog(line: string, stream = "stdout") {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!clean) return undefined;
  let value: Record<string, unknown> = {};
  try { const parsed = JSON.parse(clean); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed; } catch { /* Plain process output is still a log. */ }
  const level = String(value.LogLevel ?? value.level ?? clean.match(/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|CRITICAL|FATAL)\b/i)?.[1] ?? "INFO").toUpperCase();
  const attributes: Record<string, string | number | boolean> = { "log.iostream": stream };
  for (const [key, item] of Object.entries(value)) {
    if (["Message", "message", "LogLevel", "level", "State", "Scopes"].includes(key)) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") attributes[key] = item;
  }
  if (value.Category) attributes["log.category"] = String(value.Category);
  if (value.Exception) attributes["exception.stacktrace"] = String(value.Exception);
  return {
    body: String(value.Message ?? value.message ?? clean).slice(0, 65536),
    severityText: level,
    severityNumber: severities[level] ?? 9,
    attributes,
  };
}

export class LocalLogs {
  private providers = new Map<string, LoggerProvider>();
  constructor(private endpoint: string) {}
  emit(service: string, line: string, stream = "stdout", extra: Record<string, string> = {}) {
    const record = parseLog(line, stream);
    if (!record) return;
    let provider = this.providers.get(service);
    if (!provider) {
      const exporter = new OTLPLogExporter({ url: `${this.endpoint.replace(/\/$/, "")}/v1/logs`, timeoutMillis: 3000 });
      provider = new LoggerProvider({
        resource: resourceFromAttributes({ "service.name": service, "deployment.environment.name": "local" }),
        processors: [new BatchLogRecordProcessor({ exporter: {
          export(records, callback) {
            exporter.export(records, result => {
              if (result.code !== 0) console.error(`OTLP log export failed for ${service}: ${result.error?.message ?? "collector unavailable"}`);
              callback(result);
            });
          },
          shutdown: () => exporter.shutdown(),
          forceFlush: () => exporter.forceFlush(),
        }, scheduledDelayMillis: 500, maxQueueSize: 4096, maxExportBatchSize: 256, exportTimeoutMillis: 4000 })],
      });
      this.providers.set(service, provider);
    }
    provider.getLogger("flarestack.local-processes").emit({ ...record, attributes: { ...record.attributes, ...extra } });
  }
  async shutdown() { await Promise.all([...this.providers.values()].map(provider => provider.shutdown())); }
}

export async function readLines(stream: ReadableStream<Uint8Array>, consume: (line: string) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { pending += decoder.decode(); break; }
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      // Bound a process emitting a pathological single line.
      while (pending.length > 65536) { consume(pending.slice(0, 65536)); pending = pending.slice(65536); }
    }
    if (pending) consume(pending);
  } finally { reader.releaseLock(); }
}
