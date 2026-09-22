# Upgrade the application

Keep all Flarestack NuGet packages, the npm runtime and template-generated
infrastructure on one compatible release. Private binding requests negotiate the
protocol and fail on an incompatible peer.

For this local-packaged preview, retain the provided archives and patches. When
upgrading, replace them with a tested package set and update dependency references
and lockfiles together. Do not overwrite an existing application with `dotnet new`.

Back up D1 data and Alchemy state before changing a shared environment. Preserve
the stack name, stage, resource identities and OIDC client ID. Test migrations
against a copy first. Add new numbered migration files; package rollback does not
undo schema changes. Redeploy the same named stage to apply the update.

Use `bun run doctor`, build the application, run browser isolation tests and verify
Aspire telemetry locally in both modes. See [deployment](deployment.md) for cloud
checks and [API changes](api-migration.md) for compatibility notes.
