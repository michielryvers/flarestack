# Contributing

Use the versions pinned by `global.json`, `package.json` and the AppHost: .NET SDK
10.0.401, Bun 1.4.2 and Aspire CLI 13.5.3. Docker is needed for Container mode and
cloud deployment. Browser tests additionally require Node.js 20 or later (the
pinned Playwright CLI runs under Node).
Read [AGENTS.md](AGENTS.md) for process ownership and telemetry requirements.

```sh
bun install --frozen-lockfile
bun run prepare:local
bun run check
bun test ./spikes/compatibility ./src/alchemy ./scripts/local-mode.test.ts
bun run test:template
dotnet test Flarestack.slnx
bunx playwright install chromium
aspire run
```

`prepare:local` builds the repository's local package set and must run with this
AppHost stopped. It is a contributor workflow; users of published templates
resolve their pinned packages from registries.

With the app running, run `bun run test:e2e`, then `bun run verify:telemetry`.
Use `aspire start`, `aspire wait todo` and `aspire stop` for a background session.
`bun run test:acceptance` exercises a freshly generated application with restart,
migration and telemetry checks. Browser tests use Playwright's managed Chromium;
`CHROMIUM_PATH` is an optional explicit browser executable override.

Stop Fast mode before `bun run dev:container`. Container mode keeps Alchemy as the
only container owner. The authenticated OTLP relay selects the Linux Docker bridge
address or a Docker Desktop listener; `FLARESTACK_RELAY_HOST` overrides its bind
address. Windows Container mode and macOS require separate runtime verification;
the initial CI covers Linux and Windows Fast mode plus Linux Container mode.
Adding CI coverage is not evidence of a passing run: use the actual workflow result.

Keep public API baselines current for intentional additions and preserve existing
public signatures. Include focused tests for behavior changes. Verify W3C trace
propagation and avoid logging credentials or account data. Keep framework changes,
formatting and generated output distinguishable in review. Do not commit `.env`,
Alchemy state, package artifacts, machine settings or raw telemetry.

Pull requests run local tests only. CI does not deploy or destroy cloud resources.
Cloud validation requires an explicitly configured, disposable environment and
separate authorization. Publishing uses immutable package versions; do not
republish a release version or remove required dependency patches silently.

Contributions are provided under the [MIT license](LICENSE). Vendored guidance
retains its upstream license in `.agents/skills/DOTNET-SKILLS-LICENSE`.

## Preparing a package release

Read [release policy](docs/releases.md) before changing package versions. Keep the
complete release/protocol set aligned with `bun scripts/check-versions.ts`; add
`bun test ./scripts/release-policy.test.ts` to local validation. The tagged release
workflow produces candidate artifacts by default and never deploys cloud resources.
Publication additionally requires an explicit manual opt-in, registry-readiness
gates and the protected `package-publication` environment. The current template
still depends on bundled archives and Alchemy patches, so publication is blocked.
