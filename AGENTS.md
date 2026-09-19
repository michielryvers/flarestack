# Local observability

All local application and infrastructure processes must have their logs exported
through OpenTelemetry, preferably to Aspire. Console-only logging is insufficient.

For the local Todo app, use `aspire run` (or `bun run dev`). The AppHost owns the
Aspire dashboard, the Alchemy supervisor, and fast-mode .NET watch process.
Alchemy remains the only owner of Workers, D1, migrations and containers.
Fast mode is the default; `Flarestack__LocalMode=Container aspire run` uses Docker.
Do not launch a second app process in container mode. Use `aspire start`,
`aspire wait`, `aspire resource`, and `aspire stop` for agent lifecycle operations.
The host-side OTLP collector covers Worker/auth, Alchemy, build/watch and container
proxy output. Run `bun run verify:telemetry` after E2E; set
`FLARESTACK_TEST_MODE=Container` for verification against container mode.

Keep new local components in that collection path, or configure a native OTLP
exporter to the shared receiver. Do not silently bypass telemetry by using the raw
Alchemy command as the normal development workflow. Do not log secrets, auth
cookies, authorization headers, or OAuth query state.

Native .NET and Worker traces are implemented. Preserve W3C propagation across
the edge, .NET, and internal D1/auth handlers. Verify traces in Aspire after changes;
console log messages alone are not traces. Metrics are not configured.
