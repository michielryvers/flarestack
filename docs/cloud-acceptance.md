# Generated-project cloud acceptance

This opt-in runner deploys a named, disposable **staging** application from an exact
packed template. It is separate from ordinary local CI and does not run on a push
or pull request. No cloud execution is implied by the presence of this runner.

Install the pinned SDK/Bun/Aspire tools, Docker and Playwright Chromium. Configure
an existing Alchemy Cloudflare profile or scoped Cloudflare CI credentials. The
account must already have a workers.dev subdomain. Choose a unique application name
and an absolute private workspace outside the source repository:

```sh
bun scripts/accept-cloud.ts --app-name FlarestackJourneySept20 --workspace /absolute/private/flarestack-journey --stage staging --template artifacts/templates/Flarestack.Templates.0.1.0-local.2.nupkg
```

This command performs real cloud mutations. It creates the application once,
restores dependencies, and invokes `aspire deploy --environment staging` with
noninteractive execution. Its generated stack identity is printed before deployment.
Reusing the same workspace requires the same application name and template digest;
existing application files and private state are never silently replaced.

The runner requires the generated **no-email staging configuration**. It creates
two synthetic accounts, signs in through the actual browser OIDC flow, and checks
ASP.NET authentication, antiforgery enforcement, Todo CRUD, cross-user read/write
isolation and logout. It retains a synthetic Todo, adds a migration that changes
only that row, redeploys, and checks the row ID, owner and changed title. A further
redeployment verifies that the migration did not run twice. User IDs are checked
across fresh sign-ins after each deployment. The owner ID from account settings is
persisted privately and supplied as the sole bootstrap administrator on the existing
migration redeployment. Administrator checks cover promotion/demotion,
disable/enable, invalidation of the target's open workspace, and session revocation.
No extra deployment is needed for these checks. A resumed run uses the persisted
bootstrap administrator to restore the synthetic target to enabled/user before
signing it in, so interruption during an admin mutation remains recoverable.

Email verification, delivery and recovery are not tested; neither are cold starts
or correlated cloud traces. An email-enabled configuration
is refused rather than silently weakening its verification policy. Running the
local E2E suite unchanged would not prove cloud coverage because it uses a local
inbox and restarts local resources.

The workspace directory uses mode 0700 and credential state uses mode 0600 on Unix.
Keep it private; the generated app's Alchemy state also belongs there. Detailed
process output is sanitized and exported to a temporary Aspire receiver. The
persisted transcript contains only controlled phase/status records, not raw process
or browser output. No passwords, session cookies or OIDC query strings are printed.

## Explicit teardown

The runner never destroys resources, including after failure or interruption. It
prints the exact target and a command to run from the generated application's
directory when teardown is separately approved:

```sh
bun run destroy:cloud --environment staging --confirm app-flarestackjourneysept20-staging
```

This permanently removes that staging application's database and resources. Keep
the private workspace until redeployment and teardown work is complete.

## Protected CI invocation

The **Opt-in cloud acceptance** workflow requires an app-name prefix twice, appends
the GitHub run ID and attempt to make every execution a fresh target, and uses the
`cloud-acceptance` GitHub environment. Administrators must configure required
reviewers, allowed refs, and scoped `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
secrets before enabling it. YAML references alone do not create review protection.
Only the deployment step receives these secrets. Dependency installation and
package builds do not receive them.

The runner's workspace is stable through all redeployments within that job, but
hosted runners are ephemeral afterward. Only the controlled transcript is uploaded;
credentials, Alchemy state and raw logs are excluded. Retain the transcript's exact generated identity for separately confirmed
teardown using the same Cloudflare account. Regenerate the same application identity
and staging configuration to use Alchemy remote state for that explicitly confirmed
teardown; the transcript does not provide credentials for resuming browser checks. This workflow does not automatically
destroy resources or upload a resumable private workspace.

For an existing deployment, `scripts/smoke-cloud.ts` is read-only. Set a canonical
HTTPS `FLARESTACK_SMOKE_ORIGIN`, the stack name in `FLARESTACK_SMOKE_APP_NAME`, and
`FLARESTACK_SMOKE_STAGE=staging` or `production`. It checks discovery, health and
private-route rejection only, with no authenticated-user or email claim.
