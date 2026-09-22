# Short-path implementation plan

Baseline: commit `78151b2`, 20 September 2026. This document records work in
progress; a listed acceptance check is not evidence that it has passed.

## Baseline

- `dotnet test tests/Flarestack.Tests`: 109 passed.
- `dotnet test tests/Flarestack.Hosting.Tests`: 35 passed.
- `bun run check`: passed.
- `bun test ./spikes/compatibility ./src/alchemy`: 60 passed.
- `bun test ./scripts/template.test.ts`: 2 passed.
- `bun run check:versions`: passed; package version `0.1.0-local.2`, protocol 2.
- Existing local and cloud-preview evidence is retained in its original documents;
  it does not prove generated-project deployment through Aspire.

Use explicit Bun test paths: bare filters can discover ignored audit snapshots.

## Boundaries

- `src/Aspire.Hosting.Flarestack`: pinned Aspire 13.5.3 local orchestration and
  a small experimental deployment-pipeline adapter.
- `src/alchemy`: authoritative Cloudflare resource graph, private handlers,
  local supervisor, and reusable deployment runner.
- `samples/Todo/infra`: application-owned database, auth/client configuration,
  Worker entrypoint, and one shared local/cloud stack entrypoint.
- `scripts/stage-template.ts`: generated-project configuration and packaging.
- `scripts/accept-template.ts`: out-of-repository packaged acceptance.
- .NET clients: private protocol 2, live session validation, owner-filtered
  application access. Preserve these contracts.

## Reviewable work units

1. **Generated deployment**: package runner and stage configuration; Aspire deploy
   adapter; stable Alchemy identities/secrets; unified infrastructure entrypoint;
   smoke check; explicit, separately confirmed destruction. Test model/list-step
   behavior without cloud mutation, then deploy a fresh packaged app.
2. **Consumer API**: one normal Aspire registration, builder-owned configuration,
   root extension namespaces, callback-free validated .NET registrations,
   compatibility notes and API baselines.
3. **Portability and extension points**: cross-platform commands/path handling,
   managed Playwright browser, authenticated container telemetry routing, focused
   infrastructure options, Linux/Windows generated-project CI.
4. **Release foundations**: MIT license, security/contributor/release guidance,
   metadata and Source Link, reproducible immutable package workflow, dependency
   updates. Keep local preview packaging distinct from published consumption.
5. **Production gate**: durable Data Protection keys if safely achievable;
   otherwise explicitly document ephemeral keys and constrain one container.
6. **Acceptance and front door**: concise root README, task-oriented generated
   README, isolated live deploy/redeploy/migration checks, recorded commands,
   actual platform results, limitations, and explicitly deferred features.

## Decisions

- Keep all existing Flarestack product/package/template names.
- License: MIT, selected by the owner.
- Deploy target must be explicitly lowercase `staging` or `production`.
  Aspire 13.5.3 supports `aspire deploy --environment staging`; its default
  `Production` is rejected rather than silently selecting a production stage.
- Register a pipeline step only for deploy; neither model evaluation, listing,
  ordinary publish, nor tests may implicitly deploy or destroy resources.
- Use Alchemy's existing stable `BetterAuthSecret` random resource and encrypted
  Cloudflare state. Never generate a plaintext project signing-secret file.
- A Cloudflare dry run can initialize shared Alchemy state infrastructure; do
  not describe it as a guaranteed mutation-free operation.
- Cloud teardown always names and confirms the exact app/stage target. It is
  separate from deployment and acceptance execution.
- Keep one application container; no multi-instance Blazor promise.

## Outstanding evidence

- [x] New generated project: local Fast and Container acceptance.
- [x] Linux Fast/Container and Windows Fast generated-project CI results.
- [x] Fresh generated project: `aspire deploy --environment staging`.
- [x] Live health/auth/Todo/ownership/session checks, with email coverage stated.
- [x] Redeploy and migration preserve data and stable resources.
- [x] Capture cloud diagnostics before any teardown.
- [ ] Separately confirmed test-stage teardown; awaiting the owner's decision.
- [x] Secret scans of source, generated artifacts, and deployment transcript.
- [x] Release artifacts and publication/credential limitations documented.

## Implementation checkpoint

Implemented the Aspire pipeline adapter and canonical builder API, a packaged
stage/deploy runner, one sample Alchemy entrypoint, stage settings, explicit destroy
confirmation, API registration facades, portable local launchers/relay, MIT and
release/CI foundations. The generated README now separates application tasks from
maintainer preview history. Production remains gated on acknowledging ephemeral
Data Protection keys.

Focused validation at this checkpoint: 114 application tests, 63 hosting tests,
107 Bun tests, TypeScript check, package creation and two template-generation cases
passed. Fresh packaged Fast/Container journeys, the new live cloud journey, Windows
CI and final extension-point tests remain in progress. Counts are checkpoints,
not a final validation matrix.

Current executed evidence is maintained in [the acceptance record](short-path-results.md);
the implementation checkpoint above is historical. Local state migration also
preserves the original Todo installation without deleting remote state.
