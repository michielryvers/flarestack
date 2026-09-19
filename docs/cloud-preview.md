# Cloud Preview 0.1: deferred validation runbook

**No cloud deployment or real email send has been executed.** The next cloud run
must use a disposable, uniquely named `preview-<timestamp>-<suffix>` stage. Keep
state/resource IDs stable for its second deployment. Do not use a production stage.

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
  A tested cloud entrypoint/deployment integration is a remaining cloud milestone.

## Read-only preflight (after deployment)

```sh
FLARESTACK_SMOKE_STAGE=preview-unique-id \
FLARESTACK_SMOKE_ORIGIN=https://your-preview.example.com \
bun run smoke:cloud
```

This script checks HTTPS OIDC metadata, app/platform health and the private-route
boundary. It does not deploy, send email, create users or claim a complete smoke
pass. It has intentionally not been run against Cloudflare yet.

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
