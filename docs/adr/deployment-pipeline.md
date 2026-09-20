# ADR: Aspire invokes the Flarestack deployment runner

Status: accepted for the first deployment adapter slice. Aspire.Hosting and the CLI are pinned to 13.5.3.

## Ownership

Aspire selects the deployment environment and schedules one Flarestack deployment step. The reusable Bun package runner owns deployment configuration, build-context preparation, Alchemy invocation, telemetry export, and stage-specific infrastructure identity. Alchemy remains the owner of Workers, D1, migrations, and containers. The hosting package does not duplicate those resource implementations.

Existing `AddFlarestack` and `AddFlarestackPlatform(...).WithApplication(...)` signatures remain unchanged. Local run composition retains its endpoints, shared secret parameter, traced watcher, and health dependencies. In Aspire publish mode, composition omits local settings-file reads, bridge credentials, endpoints, the watcher, and local readiness checks. The platform resource is excluded from ordinary manifest publishing; its custom pipeline annotation remains available to Aspire.

## Environment and invocation contract

Use either:

```sh
aspire deploy --environment staging --non-interactive
aspire deploy --environment production --non-interactive
```

Only the exact lowercase names `staging` and `production` are accepted. Aspire CLI 13.5.3 defaults to `Production` when the option is omitted and forwards that value to the AppHost. Rejecting that capitalized default makes choosing a target explicit; `Production`, `Staging`, development, and preview names fail before a deployment child starts. The adapter reads `builder.Environment.EnvironmentName` and does not infer the target from the current directory or a cloud credential.

The infrastructure package declares a bare direct runner command:

```json
{
  "scripts": {
    "flarestack:deploy": "bun ../node_modules/@flarestack/alchemy/deploy/cli.ts ../local.json"
  }
}
```

The first runner argument identifies the shared application configuration relative to the infrastructure directory. Deployment ignores `local.machine.json`; local development continues to apply and validate it.

The adapter appends `deploy --environment <environment>` and sets the child's working directory to the infrastructure directory. It uses `ProcessStartInfo.ArgumentList`, never a shell. The existing direct-command parser rejects shell operators. Paths containing spaces are supported through quoted manifest arguments.

The deployment script is optional for local consumers. It is read and validated only when the deploy action executes, so listing steps and publishing do not require a deployment script or invoke cloud tooling. A missing script produces an actionable error naming `flarestack:deploy`.

Credentials stay in inherited environment variables or the configured Alchemy profile. The adapter does not place credentials in arguments, write them into artifacts, or log the environment or command. The package runner must sanitize subprocess output before emitting its own stdout/stderr; those safe lines are forwarded to the Aspire pipeline logger. The runner also owns deployment OTLP export: pipeline console output alone is insufficient, and Aspire publish mode does not start a local dashboard automatically. It uses `FLARESTACK_DEPLOY_OTLP_ENDPOINT` when explicitly configured; otherwise it owns an isolated Aspire receiver on ephemeral loopback ports. The package sanitizes known secret environment values, authorization headers, and OAuth query values before emitting console or OTLP output, including Docker and .NET preflight output.

## Pinned Aspire integration

CLI 13.5.3 translates `aspire deploy` to AppHost arguments `--operation publish --step deploy`. There is no separate deploy execution mode. The hosting adapter registers a `WithPipelineStepFactory` annotation only in publish mode. Its factory constructs metadata without starting processes:

- Step name: `<platform-name>-deploy`.
- Depends on: `WellKnownPipelineSteps.DeployPrereq`.
- Required by: `WellKnownPipelineSteps.Deploy`.
- Resource: the typed Flarestack platform.

The action additionally requires `Pipeline:Step` to equal `deploy`. Ordinary publish, destroy, and a raw publish operation without a selected entry point cannot invoke it. This slice intentionally does not support `aspire do <platform-name>-deploy` or register a destroy action.

Aspire 13.5.3 marks `WithPipelineStepFactory`, `PipelineStep`, and the well-known pipeline constants with `ASPIREPIPELINES001`. A scoped pragma in the internal adapter and its contract tests acknowledges that upstream experimental API. It does not suppress other warnings or expose Aspire's experimental types through Flarestack's public API. No analyzer is disabled project-wide.

Reference implementations are pinned to the installed package's repository commit:

- [Pipeline factory extensions](https://github.com/microsoft/aspire/blob/b5f143315ffb6968ea939a9978797a5b20e4c688/src/Aspire.Hosting/Pipelines/PipelineStepFactoryExtensions.cs)
- [CLI deploy argument mapping](https://github.com/microsoft/aspire/blob/b5f143315ffb6968ea939a9978797a5b20e4c688/src/Aspire.Cli/Commands/DeployCommand.cs)
- [Pipeline annotation collection and execution](https://github.com/microsoft/aspire/blob/b5f143315ffb6968ea939a9978797a5b20e4c688/src/Aspire.Hosting/Pipelines/DistributedApplicationPipeline.cs)

## Process lifecycle and validation

The adapter drains stdout and stderr concurrently. A nonzero exit fails the deployment step and reports the exit code without adding raw command details. Cancellation kills the deployment process tree, waits for exit, drains output, and propagates cancellation. The package runner should also clean up its own temporary files and telemetry resources where graceful cleanup is possible; the host's process-tree kill is the final cancellation boundary.

Contract tests exercise both existing local registration shapes, publish-mode omission of local resources, the deployment graph, side-effect-free step factories, exact stage selection, argument boundaries and working directory, missing or compound commands, safe failure output, and cancellation of a real fixture process and its child. These tests use controlled fixture commands and perform no cloud mutation.


## Stable identity and authentication state

The committed stack name and explicit Alchemy stage identify infrastructure across deploys. The public Worker name derives from both, with a deterministic hash suffix for long names. Keep the stack name, stage, resource logical names, and OAuth client resource identity stable when moving an application. Changing these identities can create new infrastructure instead of updating the existing resources.

`createAuthWorker` delegates its signing secret to the pinned Better Auth integration. That integration creates a stable `Alchemy.Random` resource (`${id}Secret`) and binds its redacted value into the Worker. It does not generate a fresh secret on each request or deployment. The stack uses `Cloudflare.state()`: the pinned backend encrypts resource state at rest with an AES-CTR key held in Cloudflare Secrets Store. The runner's local deployment receipt records identity and status, never this signing secret or credentials. Preserve the Alchemy state and its encryption key to retain the signing identity; losing or intentionally replacing that state can invalidate existing sessions.

This durable Better Auth secret is separate from the container's ASP.NET Data Protection keys. The current container keys are ephemeral. Production therefore requires the explicit `allowEphemeralDataProtectionKeys` acknowledgement because container replacement can require fresh sign-in even while D1 data and Better Auth state remain intact.

The automatic deployment smoke check covers discovery issuer/endpoints, edge/container health, and rejection of private bridge routes. It does not prove a complete browser login, email delivery, or application CRUD workflow; those require separate acceptance checks against the selected deployment.


## Destructive deployment plans

A separate destroy command is insufficient on its own: Alchemy also removes
orphaned declarations and obsolete replacement generations during normal apply.
The pinned engine therefore includes an opt-in removal guard enabled by the
Flarestack runner. It inspects the exact plan being applied, including nested
state-backend provisioning, and rejects deletion, orphaning, replacement and
pending replacement cleanup. Garbage collection has its own fail-closed check.
The runner checks the patch's support marker before invoking cloud operations;
an unpatched dependency cannot silently bypass this requirement.

The normal deploy command has no override. Only the separate destroy operation,
after exact stage confirmation, omits the guard. This is an intentionally scoped
addition to the existing pinned Alchemy patch, not a second provisioning engine
or a parse of terminal plan output. It must be removed only when equivalent
upstream protection is available and verified. Deployments to a stage must run
serially; this preview does not add a distributed deployment lock.
