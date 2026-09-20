# Cloud Preview 0.1: deployment and validation

The first preview was deployed on 2026-09-20 at
<https://flarestack-preview.proeftu.in>, stage `preview-20260920-a1`.
Cloudflare owns the running container, D1 and private Auth/Email Workers;
Alchemy owns provisioning. The preview is capped at one `lite` container instance.
Use a uniquely named `preview-<timestamp>-<suffix>` stage for another disposable
environment. Keep state/resource IDs stable when redeploying an existing stage.

## Repository commands

```sh
# Stop the local AppHost before rebuilding the package set.
aspire stop --non-interactive
bun run prepare:local
bun run plan:cloud
bun run deploy:cloud
```

The non-secret stage, HTTPS origin and sender live in `samples/Todo/cloud.json`.
The runner stages a clean image context without Development settings and runs
the infrastructure project's installed Alchemy CLI. Resolving the repository's
separate CLI copy caused an Effect secret-registry error; the runner avoids that
duplicate runtime. Use the existing authenticated Alchemy profile. Local deployment
logs export to a temporary Aspire receiver at port 18889.

The cloud entrypoint uses Production mode, a canonical custom domain and private
bindings. Native Cloudflare Worker/container logs are enabled. Cloud OTLP export
is disabled unless `FLARESTACK_CLOUD_OTLP_ENDPOINT` is supplied; cloud .NET spans
are **not** currently sent to local Aspire. Local OTLP behavior is unchanged.

## Measured first-deployment coverage

- Image build/push, container startup, empty D1/auth migrations and OAuth client provisioning.
- HTTPS custom domain, OIDC discovery, health checks and private-route rejection.
- Real verification email from `flarestack@proeftu.in`; receipt and verification confirmed by the recipient.
- Verified login, PKCE/OIDC callback, ASP.NET cookie, owned D1 workspace read, and Blazor WebSocket/SignalR handshake.
- Image redeployment with the same stage and existing account retained.

Full browser CRUD/isolation, recovery email, cloud admin revocation, sleep/wake,
an added cloud migration and end-to-end cloud OTLP remain separate checks below.

For repeatable authentication smoke checks, use an already verified disposable
account stored in an ignored, mode-0600 JSON file with `email` and `password`:

```sh
FLARESTACK_SMOKE_ORIGIN=https://flarestack-preview.proeftu.in \
FLARESTACK_SMOKE_ACCOUNT=/private/path/test-account.json \
bun scripts/smoke-cloud-session.ts
```

The check never prints passwords, cookies, codes or OAuth query state. Container
filesystem data-protection keys are ephemeral: a replacement can require fresh
sign-in even though users/tasks remain in D1. This is still a preview.

## Before deploying

- Use the exact packed release set exercised by `test:acceptance`; retain its
  NuGet/npm archives, lockfile, version/protocol and commit as evidence.
- Configure an HTTPS custom domain and matching public issuer/callback/logout URLs.
  Supply auth secrets and bootstrap IDs through stage configuration. Remove local
  inbox/bridge settings, the Development environment and host-only OTLP endpoints.
- Onboard a real sending domain and controlled test mailbox. Decide how automation
  retrieves verification/reset messages; the local `.eml` inbox is not a cloud
  mailbox adapter. Do not put message links or tokens in CI output.
- Review Alchemy's actual deployment inputs and account permissions before use.
  `aspire deploy` is **not implemented or promised** by the current hosting package;
  it currently models local executable resources. Alchemy is the resource owner.
  The repository's `cloud.run.ts` and deployment runner are the tested cloud entrypoint.

## Read-only preflight (after deployment)

```sh
FLARESTACK_SMOKE_STAGE=preview-unique-id \
FLARESTACK_SMOKE_ORIGIN=https://your-preview.example.com \
bun run smoke:cloud
```

This script checks HTTPS OIDC metadata, app/platform health and the private-route
boundary. It does not deploy, send email, create users or claim a complete smoke
pass. It passed against the preview above.

## Full vertical-slice evidence to collect

| Phase | Required evidence |
| --- | --- |
| First deployment | Container image/build/start; empty D1 app/auth migrations; exactly one OAuth client |
| Browser | Worker → Container HTTP and Blazor WebSocket; verified signup; real PKCE login; owned CRUD; cross-user isolation; logout |
| Email | Real verification and password-reset delivery; expiring/single-use link; old sessions rejected |
| Administration | Bootstrap via stage config; demotion/disable/revoke; next operation rejected; open circuit invalidation |
| Cold start | Container sleep/wake and explicit restart; reconnect behavior and persisted data |
| Redeployment | Same artifacts/stage IDs; no lost users/tasks or duplicate provisioning |
| Migration | Add one numbered migration, deploy, verify it and old data; repeat with no duplicate application |
| Observability | Correlated Worker/.NET/D1/auth/email traces; failures visible; no cookies, headers, state or message secrets |

Record cloud-only failure modes separately from Fast/Container results. Publishing
packages waits for this evidence; local success is not proof of Cloudflare behavior.
