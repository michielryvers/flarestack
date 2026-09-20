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

Results: 177 .NET tests, 162 Bun tests and two template-generation tests passed.
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
confirmation is pending. Earlier manual Todo preview delivery is recorded separately.

At 21:30:08 UTC the control plane reported the application container inactive.
A subsequent single health request returned HTTP 200 in 3.293 seconds, and a
follow-up observed a running instance with a new start timestamp. That timestamp
preceded the health request, so concurrent traffic or delayed control-plane
reporting prevents attributing the wake to that request. Sleep/restart and healthy
recovery were observed; isolated first-request cold-start latency remains
unverified. Cloud trace export and fault injection were not tested.

An earlier refreshed archive (digest recorded below) was redeployed to the same
stage at 21:38:09 UTC. Frozen dependency installation, TypeScript checking, forced
NuGet restore and a clean generated-app build passed first. The redeploy passed
HTTPS OIDC discovery, health/readiness, and rejection of private auth/D1 routes.
Hashes confirmed unchanged email settings, application identity, infrastructure
sources, migrations, original acceptance state and its original archive. This
refresh did not rerun the full browser suite or request another email; the full
journey above and this final redeploy remain separate evidence.

No automatic teardown occurred. Destruction must separately name and confirm
`app-journeysept20-staging`; the stage and private evidence workspace are retained.

## Publication safety

Gitleaks 8.30.1 scanned the tracked-source snapshot, recursively unpacked template
archives, and retained deployment/local-validation logs. Archives and logs had no
findings. The source scan matched one vendored skills provenance digest; all 65
manifest SHA-256 values were independently recomputed and matched their files.
No credential exception or scanner suppression was added. Private credentials,
account fixtures and state snapshots remain outside tracked source.

## Hosted CI and limitations

Linux Fast and Container journeys passed locally and in hosted CI run
[35537980021](https://github.com/michielryvers/flarestack/actions/runs/35537980021).
Clean local runs with `CI=true` passed after moving development state off the
cloud backend: Fast `run-fbVD5g`, Container `run-Inm3QJ`, each with seven browser
cases, migration/restart and connected traces. Their connected D1 trace IDs were
`783a46908508dd1dd496c370be12d03e` (Fast) and
`5b29cc5593adb2e85576a65a347c48cb` (Container). A prior local Bun install stalled;
an isolated retry recovered it, and the final fresh Fast run completed unaided.

Windows now completes packaging and process-tree cleanup. Its hosted run found a
test expectation using an 8.3 temporary-path alias rather than the canonical path;
that assertion was corrected. The next run started a healthy generated app but
three browser cases could not launch Aspire through Node on Windows. A shared
no-shell resolver reads the pinned SDK’s Windows `.cmd` launcher as metadata and
passes its package executable directly. Tests cover the supported launcher shape,
case-insensitive PATH keys and literal arguments. An early CI probe uses real Node
to catch executable-resolution failures before packaging. Full Windows acceptance is
being rerun. macOS and Windows Container mode remain unverified.

The original local Todo installation was also migrated: eight legacy development
state records were imported through read-only remote requests into private local
files. The database ID was matched to the existing simulator SQLite filename;
pre-existing users and Todo rows exactly matched the private pre-migration backup
after restart. Root account/Todo browser tests and connected Aspire traces passed.
No remote state was deleted.

## Final artifacts and local state

| Template artifact | SHA-256 |
| --- | --- |
| Earlier cloud refresh | `8107163c056a878c3b0921a93aa06bdffb09a0f3426c0382c926d5753278a3d7` |
| Final cloud runtime validation | `53e29639788a2b10613d7435b7402cf97e549c83aee28ae80f410e38ee15c999` |

The final template changes browser-test helpers, their documented Node.js
prerequisite, package repository metadata, and lockfile generation relative to the
earlier cloud refresh. Its registry resolutions come from the reviewed root lock;
repeat staging is byte-identical, and a clean external frozen install/typecheck
passed without changing that lock. The generated workspace name matches the app.
All five embedded runtime packages and application/infrastructure sources are
byte-identical, but one nested logging dependency changes to the root-reviewed
OpenTelemetry API 1.9.1. This exact final archive completed frozen installation,
TypeScript checking, restore/build and same-stage Aspire deployment at
22:17:39 UTC. HTTPS OIDC, health/readiness and private-boundary checks passed;
email configuration, bootstrap identity, migrations and original acceptance
evidence were preserved. The final deployment logs passed both a known-credential
check and Gitleaks. No additional signup or email was requested. The latest local template adds only a sign-in test helper; its digest is
`a1c20511e2e1b0a552585a01a1b39bfb00b145deb5147188eb9f9f6b4124b365`.
It submits once, reports allowlisted route/status timing, and fails promptly on a
classified error. The bounded successful-login wait is 15 seconds; unrelated
assertions retain their existing limits. Two real-browser contract tests cover a
delayed success and immediate failure without retries or credential output.
Both template cases passed with 832 assertions, and the complete Bun suite passed
162 tests with 726 assertions. The final helper passed all three live Playwright Node cases in 72.7 seconds:
account lifecycle, password/session controls and Todo/OIDC/WASM ownership.
Successful sign-in chains took 0.3–0.4 seconds locally. Full Aspire telemetry
verification passed afterward, including all five log services and connected
Worker/.NET/D1/auth/email/WASM spans. The running dashboard contains trace
`a44c1cc5ca9fbe4741165432553a7360`.

Four isolated library packages also produced matching portable-PDB symbol
archives. The SDK-based release verifier checked assembly/PDB identities and
Source Link URLs for the exact repository commit, including shared protocol
source. Missing-symbol and wrong-commit negative checks passed. Registry symbol
publication and a debugger download session have not been exercised.

The original Todo app is restored in Fast mode, with saved administrator
configuration, HTTP 200 health, readiness and OIDC responses, logs from all required
services, and connected traces. It remains available locally.

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
