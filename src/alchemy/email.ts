import { privateRequest } from "./protocol.ts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { mimeMessage, validateEmail } from "./email-message.ts";
import { tracedRequest } from "./tracing.ts";

export interface EmailWorkerOptions { main: string; from: string; }
export function createEmailWorker(options: EmailWorkerOptions) {
  if (!validateEmail({to: options.from, subject: "test", text: "test"})) throw new Error("Invalid email sender");
  return Cloudflare.Worker("Email", { main: options.main, workersDev: false,
    compatibility: { date: "2026-09-08", flags: ["nodejs_compat"] },
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318", OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "" },
  }, Effect.gen(function* () {
    const descriptor = yield* Cloudflare.Email.SendEmail("EMAIL", { allowedSenderAddresses: [options.from] });
    const email = yield* Cloudflare.Email.Send(descriptor);
    return { fetch: Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const request = yield* HttpServerRequest.toWeb(req).pipe(Effect.orDie);
      const raw = yield* email.raw;
      const env = yield* Cloudflare.WorkerEnvironment;
      const response = yield* Effect.promise(() => tracedRequest("flarestack.email", request, r => privateRequest(r, async () => {
        if (new URL(r.url).pathname !== "/v1/email" || r.method !== "POST") return new Response(null, {status: 404});
        const body = await r.text();
        if (body.length > 150_000) return new Response(null, {status: 413});
        let message: unknown;
        try { message = JSON.parse(body); } catch { return Response.json({error: "invalid_message"}, {status: 400}); }
        if (!validateEmail(message)) return Response.json({error: "invalid_message"}, {status: 400});
        try {
          const { EmailMessage } = await import("cloudflare:email");
          await raw.send(new EmailMessage(options.from, message.to, mimeMessage(options.from, message)));
          console.log(JSON.stringify({message: "Email accepted", level: "INFO"}));
          return Response.json({accepted: true}, {status: 202});
        } catch {
          console.error(JSON.stringify({message: "Email delivery failed", level: "ERROR"}));
          return Response.json({error: "email_delivery_failed"}, {status: 502});
        }
      }), env as Record<string, string>));
      return HttpServerResponse.fromWeb(response);
    }) };
  }).pipe(Effect.provide(Cloudflare.Email.SendBinding)));
}
