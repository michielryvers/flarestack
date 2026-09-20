# Deploy an application

The deployment pipeline targets .NET 10.0.401, Aspire 13.5.3, Bun 1.4.2 and
Alchemy 2.0.0-beta.79. Aspire's custom pipeline API is experimental and isolated
in the hosting package. See the [deployment decision](adr/deployment-pipeline.md).

A fresh, packaged generated application passed this flow on 20 September 2026,
including browser authentication, ownership isolation, administration, migration
and repeated deployment. Email was disabled for that automated stage; an earlier
Todo preview separately verified delivery. See the [acceptance record](short-path-results.md)
for commands, evidence and remaining limitations.

## Configure and deploy

Install Docker and the pinned prerequisites, run `bun install`, and authenticate
Alchemy with Cloudflare from the application's infrastructure directory:

```sh
cd infra
bunx alchemy profile edit --add cloudflare
cd ..
aspire deploy --environment staging
```

For CI, supply the Cloudflare credentials supported by the pinned Alchemy provider
(`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`) through your CI secret store. Never put API tokens in `deployment.json`. A usable
workers.dev subdomain must already exist on the selected Cloudflare account.
Container deployments incur Cloudflare charges; review your account's plan.

`deployment.json` is committed, non-secret application configuration:

```json
{
  "environments": {
    "staging": {},
    "production": {}
  }
}
```

Stages must be explicitly named `staging` or `production` (lowercase). The Aspire
CLI's implicit `Production` default is rejected. The stack name in `local.json`
and selected stage define stable resources; keep both unchanged on redeployment.
The runner resolves the public origin before provisioning OIDC, stages the
application's own build sources, invokes Alchemy, applies migrations, then checks
HTTPS health, OIDC discovery and the private-route boundary. A failure retains
resources for diagnosis. A successful deploy prints the URL.

Run the same command to update the stage. Add migrations with new, increasing
filenames; do not edit migrations already applied to a shared environment.
Alchemy owns both application D1 migrations and Better Auth provisioning.

## Domains, email and secrets

A stage may set `domain` to a custom hostname on your Cloudflare account. Omit it
to use the account's workers.dev subdomain. A stage may also set:

```json
"email": { "from": "app@example.com", "requireVerification": true }
```

Configure Cloudflare Email Routing and any required verified destinations first.
Without an email setting, cloud email, verification and password recovery are
unavailable. Local development continues to capture email in the Aspire inbox.
Do not treat the health smoke check as proof of email delivery.

Alchemy creates a stable random Better Auth secret and stores it in encrypted
provider state, binding it to the Worker as a secret. Preserve the state backend
and its encryption key. Deployment output redacts credentials; do not enable
verbose HTTP logging in CI. Optional cloud OTLP settings belong in the secret
store/environment, not the committed configuration.

## Current production limitation

One application container is the default. ASP.NET Data Protection keys are not
yet durable across replacement. Users and Todo data remain in D1, but browser
authentication cookies can become invalid. This is a preview, not production-ready
multi-instance Blazor hosting.

Production is gated until its settings explicitly contain
`"allowEphemeralDataProtectionKeys": true`. This acknowledges the limitation; it
does not fix persistence. Then use `aspire deploy --environment production`.

## Explicit teardown

Teardown permanently removes the stage and its D1 data. It is never part of normal
deploy, smoke tests or local shutdown. Back up data and collect diagnostics first.

```sh
bun run destroy:cloud --environment staging
```

An interactive terminal asks you to type the exact identity printed in the prompt.
In CI, provide `--confirm <stackName>-staging` explicitly. A missing or mismatched
confirmation fails before cloud operations. There is no Aspire destroy pipeline.
