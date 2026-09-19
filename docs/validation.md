# Validation matrix

Local checks are repeatable against packed artifacts. Cloud results are deliberately
left unclaimed until the disposable-stage run.

| Capability | Fast local | Container local | Cloudflare |
| --- | --- | --- | --- |
| OIDC signup/login/logout | Browser tested | Browser tested | Not tested |
| D1 migrations and persistence | Tested | Tested | Not tested |
| Blazor WebSockets / owned CRUD | Browser tested | Browser tested | Not tested |
| Email | Capture tested | Capture tested | Delivery not tested |
| Password recovery / session controls | Browser tested | Browser tested | Not tested |
| Admin disable / live circuit revocation | Opt-in browser test | Same opt-in test available | Not tested |
| Auth failure / protocol mismatch | Unit tests + private-handler tests | Same transport contract | Not tested |
| Razor hot reload | Tested | Restart required | Not applicable |
| Clean template / upgrade | Clean install and previous-preview upgrade passed | Clean install / migration / restart tested; upgrade not run | Not tested |

## Reproduction

Preview `0.1.0-local.2` uses protocol 2. Verification includes 24 .NET tests,
60 Bun tests (137 assertions), TypeScript checks, and packed-template checks.
Fast acceptance exercised the previous `0.1.0-local.1` archive as well as a
clean installation. Both modes verify connected Worker/.NET/D1/auth/email traces
and local logs in Aspire. Actual Cloudflare deployment, delivery and cloud
failure behavior remain untested.

Build/unit/template/acceptance commands below run in the framework repository.
Generated apps expose browser tests and telemetry verification; they do not carry
framework source or the package-building acceptance runner.

```sh
bun run check
bun run check:versions
bun test src/alchemy spikes/compatibility
dotnet test tests/Flarestack.Tests/Flarestack.Tests.csproj
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
