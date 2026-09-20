import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator, ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";

export function telemetryPath(path: string) { return path.replace(/(\/auth\/reset-password\/)[^/]+/, "$1{token}"); }

// A provider per invocation avoids retaining workerd I/O across request contexts.
export async function tracedRequest(service: string, request: Request, run: (request: Request) => Promise<Response>, telemetry?: { OTEL_EXPORTER_OTLP_ENDPOINT?: string; OTEL_EXPORTER_OTLP_HEADERS?: string }): Promise<Response> {
  const exporter: SpanExporter = {
    export(spans, done) {
      const body = ProtobufTraceSerializer.serializeRequest(spans);
      fetch(`${telemetry?.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318"}/v1/traces`, { method: "POST", headers: { "content-type": "application/x-protobuf", ...Object.fromEntries((telemetry?.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",").filter(Boolean).map(pair => { const index = pair.indexOf("="); return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))]; })) }, body: body as Uint8Array<ArrayBuffer>, signal: AbortSignal.timeout(3000) })
        .then(response => done({ code: response.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED }))
        .catch(() => done({ code: ExportResultCode.FAILED }));
    }, shutdown: async () => {},
  };
  const provider = new BasicTracerProvider({ resource: resourceFromAttributes({ "service.name": service }), spanProcessors: telemetry?.OTEL_EXPORTER_OTLP_ENDPOINT === "" ? [] : [new SimpleSpanProcessor(exporter)] });
  const propagator = new W3CTraceContextPropagator();
  const parent = propagator.extract(ROOT_CONTEXT, request.headers, { keys: h => [...h.keys()], get: (h, key) => h.get(key) ?? undefined });
  const path = telemetryPath(new URL(request.url).pathname);
  const span = provider.getTracer("flarestack").startSpan(`${request.method} ${path}`, { kind: SpanKind.SERVER, attributes: { "http.request.method": request.method, "url.path": path } }, parent);
  const headers = new Headers(request.headers);
  propagator.inject(trace.setSpan(parent, span), headers, { set: (h, key, value) => h.set(key, value) });
  try {
    const response = await run(new Request(request, { headers }));
    span.setAttribute("http.response.status_code", response.status);
    if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    return response;
  } catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
  finally { span.end(); await provider.forceFlush(); await provider.shutdown(); }
}
