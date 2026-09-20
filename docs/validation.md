# Validation matrix

Local checks are repeatable against packed artifacts. Cloud results are deliberately
recorded separately from the broader local suite.

| Capability | Fast local | Container local | Generated Cloudflare stage |
| --- | --- | --- | --- |
| OIDC signup/login/logout | Packed browser test | Packed browser test | Browser/API passed |
| D1 initial migration, added migration, retained data | Passed | Passed | Passed; repeat deploy did not repeat migration |
| Interactive Auto: cold Server → cached WebAssembly CRUD | Browser tested | Packed browser tested | CRUD passed; explicit rendering-mode assertion not run |
| CSRF / owner-scoped API / cross-user isolation | Passed | Passed | Passed |
| Browser logs and connected Worker/.NET/D1/auth/email traces | Verified in Aspire | Verified in Aspire | Export not configured |
| Blazor WebSockets / owned CRUD | Passed | Passed | Browser CRUD and live workspace revocation passed |
| Email verification and password recovery | Capture + browser passed | Capture + browser passed | Automated suite disabled email; later real verification requested, recipient confirmation pending |
| Admin roles, disable/enable, session revocation | Packed browser passed | Packed browser passed | Browser/API passed |
| Auth failure / protocol mismatch | Unit + private-handler tests | Same transport contracts | Fault injection not run |
| Razor hot reload | Previously tested | Restart required | Not applicable |
| Packed clean install / restart | Passed on Linux | Passed on Linux | Fresh external generated project deployed |
| Windows hosted CI | In progress | Not run | Not applicable |
| Container sleep/wake / replacement | Startup/restart tested | Startup/restart tested | Inactive → restarted and healthy observed; isolated wake trigger/timing unverified |

The automated cloud journey used synthetic accounts with email disabled. Email
was enabled afterward and a real verification message requested; recipient
confirmation remains pending. This does
not establish verification/recovery delivery, custom-domain behavior, cloud OTLP
export, or session persistence across container replacement. The earlier
[cloud preview record](cloud-preview.md) is separate historical evidence.

## Reproduction

Preview `0.1.0-local.2` uses protocol 2. Current verification includes **177 .NET
tests**, **170 Bun tests**, TypeScript checking and two packed-template generation
tests (832 assertions). Fresh Fast and Container applications with the same name
were generated outside the repository and run concurrently on separate port
blocks. Both passed administration, recovery, Todo isolation, migration/data
retention and Aspire log/trace checks. Their Alchemy registries are app-local.

The [short-path acceptance record](short-path-results.md) distinguishes actual
local/cloud passes from hosted CI gaps. Hosted Linux Fast and Container acceptance passed; Windows remains in progress.
Merely defining its workflow is not evidence of Windows compatibility. Earlier preview-upgrade and hot-reload
results remain historical evidence; they were not repeated for this change.

Build/unit/template/acceptance commands below run in the framework repository.
Generated apps expose browser tests and telemetry verification; they do not carry
framework source or the package-building acceptance runner.

```sh
bun run check
bun run check:versions
bun run test
dotnet test Flarestack.slnx
bun run test:template
# With the app running:
bun run test:e2e
FLARESTACK_TEST_ADMIN=1 bunx playwright test admin.spec.ts
bun run verify:telemetry
# Independent disposable app, packed artifacts and isolated CLI/cache:
bun run test:acceptance
FLARESTACK_TEST_MODE=Container bun run test:acceptance
FLARESTACK_UPGRADE_FROM=/absolute/path/to/older-template.nupkg bun run test:acceptance
```

Stop the repository AppHost before rebuilding packages or running the acceptance
runner on a constrained machine. Acceptance uses ports 9200–9210 by default;
`FLARESTACK_ACCEPTANCE_PORT` selects another block. `FLARESTACK_ACCEPTANCE_ROOT` selects a disk-backed workspace root (default:
`~/.cache/flarestack/acceptance`, outside the repository to prevent workspace
resolution shortcuts). It retains its disposable workspace as evidence, stops its app/dashboard, checks an added migration and
unchanged existing records/client identities, then repeats browser checks.

The session tests cover unavailable/forbidden/expired-session responses, network
failure, timeout, malformed payloads, protocol mismatch, and stale administrator
claims. A request already authorized before revocation can still finish: see the
[security model](security-model.md).
