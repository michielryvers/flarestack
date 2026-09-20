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

# Code style and repository skills

Repository-local .NET guidance is vendored in `.agents/skills`; provenance and
license are recorded there. Consult relevant skills rather than loading all of them:

- C# readability: `.agents/skills/csharp-coding-standards/SKILL.md`.
- Public API changes: `.agents/skills/csharp-api-design/SKILL.md`.
- DI and options: `.agents/skills/microsoft-extensions-dependency-injection/SKILL.md`
  and `.agents/skills/microsoft-extensions-configuration/SKILL.md`.
- Build/package layout: `.agents/skills/project-structure/SKILL.md`.

Prefer familiar .NET library conventions: focused extension methods, explicit
options, descriptive identifiers, braces, and one statement per line. Separate
public contracts, registration, transport, and security policy when those have
independent responsibilities. Keep simple logic simple; do not introduce generic
frameworks, Result types, or allocation optimizations solely to follow a skill.

Treat upstream recommendations as guidance and check examples against the actual
SDK. Preserve our Alchemy ownership model, session validation, ownership filters,
and telemetry. Formatting changes and behavior changes should be reviewable
separately. See `docs/code-style-review.md` for the reference integrations and
proposed refactoring order. Do not reformat vendored skills or generated bundles.
