# Short-path acceptance record

Recorded 20 September 2026 for package set `0.1.0-local.2`, protocol 2.
This records executed checks, not a declaration of production readiness.

## Implementation

- Generated applications own their deployment settings and build paths. One
  Alchemy entrypoint serves local and cloud infrastructure; Aspire delegates its
  explicit deployment step to the packaged runner.
- Stable app/stage identities and encrypted Alchemy state retain the Better Auth
  secret. Teardown is separate and requires the exact stage identity.
- Canonical Aspire and .NET registration APIs remove pre-builder global mutation,
  empty callbacks and routine implementation namespaces; compatibility facades
  retain prior public methods.
- Focused infrastructure options allow routes, bindings, outbound handlers,
  container settings and social providers while reserving security-critical paths.
- Portable local commands, managed Chromium and per-app Alchemy registries support
  isolated generated apps. Both modes retain OTLP logs and connected traces.
- MIT licensing, security/contributor guidance, version checks, package metadata,
  CI and gated immutable publication workflows are included. No registry package
  was published.

See the [deployment ADR](adr/deployment-pipeline.md), [API migration note](api-migration.md)
and [validation matrix](validation.md).

## Commands executed

Commands below were run on the Linux development machine with the pinned SDK,
Bun and Aspire versions. `mise exec --` selected those installed tools; a disk-backed
`TMPDIR` avoided this machine's small temporary filesystem.

```sh
bun run prepare:local
bun run check
bun run check:versions
bun run test
dotnet test Flarestack.slnx --no-restore
bun run test:template
```

Results: 177 .NET tests, 156 Bun tests and two template-generation tests passed.
Type checking, version alignment, package creation and generated .NET/TypeScript
builds passed. No test was disabled to obtain these results.

Two packed-template acceptance jobs ran concurrently, each generating
`Acceptance.Notes` into an external `application with spaces` directory:

```sh
FLARESTACK_ACCEPTANCE_APP_NAME=Acceptance.Notes bun run test:acceptance
FLARESTACK_ACCEPTANCE_APP_NAME=Acceptance.Notes \
  FLARESTACK_ACCEPTANCE_PORT=9400 FLARESTACK_TEST_MODE=Container \
  bun run test:acceptance
```

These are maintainer test environment variables; the cross-platform consumer
commands remain `aspire run` and `bun run dev:container`. Fast used ports 9200–9210;
Container used 9400–9410. Each passed four initial browser cases including
administration, migration/restart with unchanged rows, three repeated browser
cases, and telemetry checks. The temporary apps were stopped after validation.

Local trace evidence included connected Worker/.NET/D1 spans with SQL:
Fast trace `ee7be7b6340752fc22181aa86fdf9f05`, Container trace
`6a7b25bcc7cc25f92f4860fb4aa5839a`. These dashboard instances are stopped; trace IDs
are evidence identifiers, not currently accessible links.

## Generated cloud journey

The automated runner was invoked with an explicit application, stable private
workspace outside the repository, named stage and exact template archive:

```sh
bun run test:cloud --app-name JourneySept20 \
  --workspace /absolute/private/cloud-acceptance/journey-sept20 \
  --stage staging \
  --template /absolute/artifacts/Flarestack.Templates.0.1.0-local.2.nupkg
```

The actual workspace was under the maintainer's user cache. It retains credentials
with restricted permissions; it is neither committed nor uploaded as an artifact.
The generated application ran `aspire deploy --environment staging --non-interactive`.
The public stage is `app-journeysept20-staging`; its returned URL was
`https://app-journeysept20-staging-edge.proeftuin.workers.dev`.
This account-specific address belongs only in this maintainer evidence record,
not in generated configuration or documentation.

Sanitized transcript, UTC:

```text
20:38:22  install packed template                         PASS
20:38:23  generate JourneySept20 outside repository       PASS
20:38:39  bun restore                                    PASS
20:38:40  generated TypeScript check                     PASS
20:38:42  dotnet restore                                 PASS
20:40:14  aspire deploy --environment staging             PASS
20:48:15  OIDC, signed session, CSRF, CRUD, isolation,
          logout                                         PASS
20:48:39  deploy with added migration and bootstrap admin PASS
20:49:17  roles, disable/enable, active workspace
          invalidation, session revocation               PASS
20:49:18  retained row identity/owner and migration       PASS
20:49:43  repeat deployment                              PASS
20:50:24  repeat browser/admin checks, retained users,
          retained Todo, migration not repeated          PASS
```

Two initial browser attempts stopped on overly strict test selectors (`Continue`
versus `Continue →`, and the location/label of Sign out). They were corrected and
the complete journey rerun against the same retained stage. There was no reset of
D1 or replacement of the test identities to hide these failures.

The automated journey had email disabled: synthetic signup does not prove email
verification or recovery delivery. A subsequent deployment enabled the previously
authorized sender and successfully requested a real verification email; recipient
confirmation is pending. Earlier manual Todo preview delivery is recorded separately. Cloud trace export, explicit container sleep/wake and fault
injection were not tested. The first successful startup is not a substitute for
those lifecycle checks.

No automatic teardown occurred. Destruction must separately name and confirm
`app-journeysept20-staging`; the stage and private evidence workspace are retained.

## Hosted CI and limitations

Linux development-machine Fast and Container journeys passed. The first hosted
CI run exposed ambient mode leakage in hosting tests and an app startup timeout;
Windows had not completed package preparation at this checkpoint. Fixes and
further diagnosis are in progress. Windows/macOS compatibility is not claimed
from workflow configuration alone.

Production remains gated on explicitly acknowledging ephemeral ASP.NET Data
Protection keys; one application container is enforced. Browser cookies may become
invalid on replacement. Durable keys and general multi-instance Blazor behavior
remain unresolved.

Local-packed artifacts are the supported preview installation. Registry publication
is blocked until bundled archives/local feeds and required Alchemy patches can be
removed safely. Publication also requires protected environments and registry
credentials. See [release policy](releases.md).

Deferred: broad social providers, additional template switches, queues, cron, KV,
Turnstile, general Durable Object APIs, MCP/device authorization, durable audit,
metrics dashboards, R2 integration and backup/restore tooling. These do not replace
finishing platform validation or the production security limitations above.
