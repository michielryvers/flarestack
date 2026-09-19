# Phase 0 compatibility spike

Checked on 2026-09-19, branch `compatibility-spike`. This is an initial review
artifact, not a completed Phase 0 gate. Package APIs remain deliberately deferred.

## Exact versions

| Component | Pin |
| --- | --- |
| Bun / Bun types | 1.4.2 |
| .NET SDK | 10.0.401 |
| ASP.NET runtime | 10.0.12 |
| Alchemy / Alchemy Better Auth integration | 2.0.0-beta.79 |
| Better Auth / OAuth Provider | 1.7.5 |
| Cloudflare Containers SDK | 0.3.7 |
| Effect / platform-bun / platform-node | 4.0.0-rc.116 |
| TypeScript | 7.0.2 |
| Workers types | 5.20260919.1 |
| workerd (Alchemy transitive dependency) | 1.20260901.1 |
| Worker compatibility date | 2026-09-08 |

`package.json` pins direct dependencies; `bun.lock` pins the resolved graph.
`global.json` disables SDK roll-forward. Both Docker base images are pinned by
version and digest. Docker 29.7.2 was used for these checks. Aspire CLI 13.5.3 is
verified for the standalone dashboard and telemetry API; AppHost integration is
not yet implemented. OpenTelemetry JS SDK/exporter 0.222.0 and resources 2.11.0
are pinned for local OTLP log collection.
Alchemy's current `latest` tag is a beta; Effect's required API is a release
candidate. These are explicit compatibility risks, not stable-version claims.

## Evidence and remaining gates

| Proof | Result |
| --- | --- |
| Frozen Bun restore | Pass |
| TypeScript check of complete stack and tests | Pass |
| .NET image build | Pass, warnings treated as errors |
| Direct .NET HTTP and WebSocket echo | Pass |
| Alchemy local D1 creation and Better Auth schema migration | Pass |
| Repeated Alchemy start | Existing D1 retained; auth migration skipped as unchanged |
| Alchemy-managed .NET container, Worker HTTP proxy | Pass locally |
| WebSocket echo through Worker and container | Pass locally |
| Better Auth path-based discovery against local D1 | Pass; issuer is `http://localhost:8787/auth` |
| Unit/integration tests | 28 pass; real OAuth Provider tested with migrated in-memory SQLite |
| Container outbound D1 probe | **Unresolved:** request times out in local container network |
| Local OTLP logs to Aspire | Pass for Alchemy, both Workers, .NET, and container network proxy; verified via Aspire telemetry API |
| Remote container / remote outbound D1 | Not run |
| Full ASP.NET OIDC login and logout | Not implemented |
| Aspire resource and deployment hook | Not implemented |

The full smoke command deliberately exits nonzero while `/probe/d1` fails. It
must not be counted as a passing end-to-end test. `/probe/d1` takes no SQL input;
it posts a constant command to the internal virtual origin. Public arbitrary-SQL
paths fall through to .NET and have no Worker D1 dispatch path.

### Outbound issue reproduction

Start the spike as shown in the README, then run:

```sh
bun spikes/compatibility/smoke.ts http://localhost:8787
```

HTTP and WebSocket checks succeed; the .NET D1 request reaches its 10-second
HttpClient timeout and the smoke test fails at `/probe/d1`. A POST using `wget`
from the matching Docker proxy sidecar also timed out. This narrows the issue to
the local outbound path, but does **not** yet establish whether the cause is the
host network, workerd, Alchemy's runtime, or SDK wiring. Do not expose a public
SQL endpoint to work around it. The final probe sends a bounded JSON body with
Content-Length to remove chunked-request handling as a variable.

## API adaptations

- Alchemy 2 uses `Alchemy.Stack` and class/resource declarations. The container
  declaration extends the current `Cloudflare.Container<DotNet>(name, props)`
  overload so the native DO class type survives into `InferEnv`. This compiles;
  the brief's intended `FlarestackApp` package does not exist yet.
- `context`, `dockerfile`, `ports`, and `className` work. The Dockerfile path is
  resolved against the infra process directory, independently of build context;
  use paths based on `import.meta.dirname`. The Docker context contains only the
  disposable .NET app, rather than the complete monorepo.
- Native `@cloudflare/containers` owns runtime lifecycle and WebSocket forwarding.
  `ContainerProxy` must be re-exported from the Worker entrypoint when configuring
  outbound handlers. Assign `DotNet.outboundByHost = ...` **after** the class:
  a static field shadows the SDK's registry setter and does not register handlers.
- The spike has one public edge Worker and a separate auth service Worker with
  `workersDev: false`, linked by a service binding. This isolates the Effect-native
  Alchemy Better Auth integration from the native container runtime for this
  proof. It is an explicit topology deviation to review before package design.
  Alchemy also serves the auth service on loopback port 1337 locally; the browser
  enters through 8787. The SQL handler is not mounted on either HTTP router.
- `BetterAuth(...).auth` is an Effect; yield it inside the request before using
  Better Auth's official discovery helper functions. The Effect Worker entrypoint
  needs a default export. `Config.String` replaces older `Config.string` examples.
- Route both `/auth/.well-known/openid-configuration` and the path-based
  `/.well-known/openid-configuration/auth`, plus
  `/.well-known/oauth-authorization-server/auth`. The helpers retain the configured
  public issuer regardless of the service-binding request origin.
- Both `@effect/platform-bun` and `@effect/platform-node` must be explicit runtime
  dependencies: the CLI and local Worker bridge otherwise fail to load.
- The pinned Alchemy workerd binary rejects `2026-09-19` and reports `2026-09-08`
  as its newest supported compatibility date. Both Workers use that date.
- Local hot reload sometimes left stale container connections. Restarting the
  Alchemy process recovered HTTP/WebSocket serving without deleting D1 state.

## Next work, in order

1. Resolve the outbound timeout and pass the full local smoke command.
2. Prove the remote container/outbound path in an explicitly named cloud stage;
   record durable state bootstrap and deployment permissions.
3. Add first-party public-client provisioning and a real ASP.NET OIDC round trip.
4. Spike the Aspire custom resource and isolated deployment adapter on an exact
   stable package version.
5. Review Phase 0 findings before designing the reusable packages and Todo app.

No `aspire run` or `aspire deploy` support is claimed by this branch. No secrets,
local state, generated credentials, or database files are committed.

## Primary references

- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers/)
- [Alchemy Better Auth](https://alchemy.run/better-auth/)
- [Cloudflare container outbound bindings](https://developers.cloudflare.com/containers/configuration/workers-connections/)
- [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)

Signatures were checked against the installed packages as well as these documents.

## Local Todo vertical slice (2026-09-19)

The original outbound D1 timeout was host UFW INPUT filtering. Allowing traffic
arriving on Docker bridges restored container → workerd → D1; the original
`SELECT 1` probe then succeeded. Docker forwarding alone was insufficient.

The normal supervisor now runs `samples/Todo/Todo.Web` and the general internal
D1 protocol in `src/alchemy/d1-bridge.ts`. Original spike sources remain as
historical compatibility fixtures; their root/echo/probe smoke script is not the
Todo app's acceptance test. Use `bun run test:e2e`.

Pinned Better Auth 1.7.5 adaptations:

- Public HTTP loopback OAuth clients require `application_type: native`.
  HTTPS origins use `web`. Native loopback URI matching permits a variable port
  under the provider's RFC 8252 semantics; this is a local-development exception.
- `adminCreateOAuthClient` / `adminUpdateOAuthClient` are server-only but still
  require a session. The deploy-side action creates a passwordless provisioning
  identity and short-lived session through the provider adapter, signs an
  in-process cookie, invokes the official client API, and deletes the session.
  Runtime `clientPrivileges` denies client mutations and the trusted client is
  protected from user changes. No public bootstrap endpoint exists.
- Signing uses RS256 for standard Microsoft IdentityModel compatibility. Its
  dedicated `flarestackJwks` table avoids reusing Ed25519 keys from the original
  spike without deleting historical state. Schema is managed by Better Auth.
- Alchemy/Miniflare rewrites localhost URLs in container environment variables.
  The browser-facing local authority therefore lives in appsettings.Development.
  The backchannel still rewrites only that exact origin to `auth.internal`.
- Alchemy beta.79's root Docker context watcher ignores neither `.alchemy` nor
  build output. Staging only required sources under `.alchemy/todo-build` avoids
  a self-triggering restart loop. Restart the supervisor after .NET edits.

Native .NET OTLP and actual Worker spans now reach the standalone Aspire dashboard;
this supersedes earlier logs-only notes. Worker → ASP.NET → outbound auth and D1
use W3C trace propagation. Metrics, AppHost packaging and cloud export remain
outside this local milestone. The browser flow keeps issuer/audience/signature,
nonce, correlation, and PKCE validation enabled.

Validation for this local milestone:

- TypeScript check and 35 Bun tests passed.
- Nine .NET tests passed (parameter conversion/row mapping, owner predicates,
  strict authority rewrite and safe return URLs).
- Chromium E2E passed: home → signup → real OIDC callback → authenticated Blazor,
  add/complete/reopen/delete, two-user isolation, Docker app restart with persisted
  tasks, and logout confirmation followed by a fresh login challenge.
- `bun run verify:telemetry` confirmed OTLP logs for all five primary local
  services and connected Worker/.NET, .NET/D1, and .NET/auth traces in Aspire.
- The supervisor and app remain running locally. No Cloudflare deployment ran.

## Aspire AppHost and fast mode

`Flarestack.AppHost` now owns the dashboard and process lifecycle. The root
`aspire.config.json` makes `aspire run` select it. Aspire SDK/hosting **13.5.3** is
pinned to the installed CLI. `Aspire.Hosting.Flarestack` provides an initial
`AddFlarestack` executable-resource adapter because Alchemy remains the owner of
its complete Cloudflare graph. There is no separate Aspire D1 or Worker resource.

Default fast mode supervises a `dotnet watch` process separately from Alchemy.
The native watcher provides runtime hot reload; Aspire CLI topology watch would
restart the application and is intentionally not used as a substitute. Watch
output is exported to OTLP as well as Aspire console logs. Shared telemetry lives
in `Todo.ServiceDefaults`, and excludes exporter HTTP logging to avoid a feedback
loop. No automatic HTTP retries are added around mutating D1 requests.

The fast-mode bridge is another local Worker binding to the same D1 and Auth
resources. It listens on loopback, requires a generated secret, strips that secret
before forwarding, and only accepts the D1 protocol and auth backchannel paths.
.NET sends the secret only to a loopback configured bridge. Container mode omits
this Worker and omits the host .NET process, using the original outbound handlers.

The AppHost uses loopback HTTP for this local-only setup. Aspire UI login and OTLP
API-key authentication are enabled. `WithOtlpExporter(HttpProtobuf)` supplies the
receiver and credentials; Worker exporters and the Docker relay now honor these.
The earlier standalone workflow remains a diagnostic fallback.

Verified: fast-mode E2E plus Razor edit/revert through the Worker; container-mode
E2E; connected Worker/.NET/D1/auth traces and local logs in both modes. Switching
modes preserves D1 and provider state. Cloud deployment remains unimplemented and
has not been run.

## Framework extraction (2026-09-19)

The historical commands and findings above describe the earlier spike. Current
entrypoints live in `samples/Todo/infra`; the reusable implementation lives in
`src/alchemy`, with local process/log supervision in `src/alchemy/local`.
`FlarestackApp` composes the same resource IDs; `createAuthWorker` accepts the
sample database and OAuth client settings. The sample retains the stack name
`flarestack-compatibility` to preserve local identities. Its `.alchemy` state was
moved with the infrastructure directory. Follow the README migration note when
updating an existing checkout.

The pinned Alchemy API supports an Effect-based Worker returned from a factory;
its sample entrypoint exports that Worker as default. The container runtime class
and `ContainerProxy` must still be exported from the sample Worker entrypoint.
Container environment is passed through a JSON binding and applied by the shared
container constructor. `outboundByHost` remains an assignment after the class to
invoke the SDK registry setter.

`AddFlarestack` now owns both the supervisor and optional .NET watcher wiring,
using an explicit local configuration file and runtime directory. No framework
source imports Todo or the spike. This extraction does not add package publishing,
a template, or cloud deployment support.

## Local package consumption (2026-09-19)

`bun run prepare:local` now produces three NuGet packages and the
`@flarestack/alchemy` npm tarball at version `0.1.0-local.1`. The Todo web project
and AppHost resolve these through package references. Todo infrastructure imports
the tarball installation, including the local supervisor and watcher. The Docker
build context carries the NuGet feed and sample without framework sources.

Validation covers archive contents (including the authentication static asset),
package restore metadata, repeat packing/installing, fast-mode hot reload,
authenticated browser CRUD and isolation in both modes, and connected Aspire
logs/traces with SQL text. The npm tarball was byte-identical across repeated builds.
The package-preparation processes export logs to a temporary standalone Aspire
receiver because package bootstrap happens before the AppHost can be built.
Publishing, licensing and release policy remain outside this local preview.

## Template and fresh-database bootstrap (2026-09-19)

The `Flarestack.Templates` package generates a standalone app with bundled local
framework packages, normalized project names, a distinct stack/client identity,
and a fresh user-secrets ID. Template assembly reuses the tested Todo sample;
only metadata, generated-app instructions and layout transformations are maintained
separately. Default ports match the sample; use `configure:local` with a separate port block
when running multiple apps.

Testing a newly generated app exposed previously masked bootstrap and upgrade issues:

- The Better Auth integration's migration action and Flarestack's client action
  independently computed schema migrations, then raced to create tables in an empty
  D1 database. Flarestack now disables the integration's competing migration action
  and owns migration followed by client provisioning in one action. Its inputs
  include the auth schema so schema changes invalidate the action.
- Bun's `--no-cache` skips manifest caches but did not invalidate a locked local
  tarball at an unchanged path. Package preparation now uses a content hash in the
  tarball filename and updates the sample manifest/lockfile. Installed runtime files
  are still checked against their source before preparation succeeds.

The pinned Alchemy `2.0.0-beta.79` also signaled an unchanged resource as stable
before storing its outputs. A newly invalidated migration action could then fail
with `MissingSourceError` against an existing database. The small Bun patch in
`patches/` stores outputs before waking stable consumers. Root, sample and generated
app manifests apply the same patch during install. Keep it until the upstream
version includes this ordering fix; it does not modify database contents or state.

The pinned .NET template engine can also retain duplicate registrations when
reinstalling a rebuilt preview nupkg with `--force`. Uninstall `Flarestack.Templates`
before reinstalling the same preview version; `bun run test:template` does this.

Template verification covers normal and dotted/hyphenated names, unchanged binary
package payloads, regenerated secrets IDs, and extensionless files (`Dockerfile`
and `.gitignore`). A named solution compiled with zero warnings/errors. Generated
apps outside the repository passed fast-mode hot reload and browser E2E, and a
second app started directly in container mode on an empty D1 database and passed
browser E2E and Aspire log/trace checks, including SQL spans.

## Account lifecycle, administration and email (2026-09-19)

The runtime now includes an Alchemy email Worker and a private .NET email bridge,
plus an Aspire-linked local inbox. MIME sending is intentional: the pinned local
simulator's builder API prints message bodies, whereas its raw MIME path only
prints the capture filename. Recovery token paths are redacted in Worker telemetry.

Auth schema migration includes the Better Auth Admin plugin. OIDC session IDs are
validated through a private Worker handler for every ASP.NET cookie request and
at 30-second intervals for live Blazor circuits. Admin operations authenticate the
actor again inside that handler and use Better Auth's own mutation APIs. Bootstrap
admins are explicit user IDs in configuration; templates clear this list.

Local port configuration now derives authentication authorities and browser-test
origins, includes inbox and Docker relay ports, and namespaces auth cookies by
client ID. Platform readiness checks auth before allowing the .NET app to start.

Concurrent local Worker starts exposed `SQLITE_BUSY_RECOVERY` in the pinned
`@alchemy.run/cloudflare-runtime`. A preceding harmless compatibility warning made
its classifier treat the failure as a script configuration error, bypassing the
runtime's existing startup retry. The bundled patch classifies only that SQLite
recovery condition as a SystemError, enabling the existing bounded retry. It does
not retry user requests or modify SQLite state.


Container verification caught Alchemy's automatic loopback rewrite changing the
public OIDC authority in an environment variable to `host.docker.localhost`.
.NET correctly rejected that HTTP issuer. The local supervisor now writes the
public authority into staged development settings, while private calls continue
through service bindings. The original application settings are not modified.
Container log collection also subscribes to Docker start events so early startup
errors are captured without waiting for periodic discovery.

Administration currently provides exact-email lookup and pagination. The pinned
Better Auth/Workerd combination returned empty results for native substring
search during browser verification; the wrapper uses the verified equality filter.

Validation: 53 Bun tests, 13 .NET tests, TypeScript checking, and two template
archive/name tests pass. Browser tests cover verified signup, recovery and token
redaction, profile/password changes, self-service session controls, Todo CRUD,
logout and isolation. The opt-in admin test passes bootstrap, promotion/demotion,
disable/enable, session revocation and removal of an already-open authenticated
Blazor workspace. Fresh named apps outside the repository passed Fast and
Container mode on ports 9100–9107; Container mode was also exercised against a
fresh D1 database. Aspire verification confirms logs and connected Worker/.NET,
.NET/D1 (including SQL), .NET/auth and .NET/email spans in both modes. The port
configuration command refuses to change a running AppHost. No cloud resources
were deployed and no real email was sent.
