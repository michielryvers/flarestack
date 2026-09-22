# API compatibility in the short-path preview

Flarestack package versions and private protocol versions remain aligned. No
private bridge protocol change is required by these API additions.

Application startup can now use the root package namespaces:

```csharp
using Flarestack.Authentication;
using Flarestack.D1;
using Flarestack.Email;

builder.AddFlarestackD1();
builder.AddFlarestackEmail();
builder.AddFlarestackAuthentication();
```

Each method accepts an optional options callback and reads the same configuration
section as the existing service registration. Configured and unconfigured calls
share validation and startup checks. Existing service-collection overloads remain
available; migrating is optional. The host environment is resolved internally.

Account endpoint mapping is also available from `Flarestack.Authentication`:

```csharp
app.MapFlarestackAccountEndpoints(options =>
{
    options.DefaultReturnPath = "/todos";
});
```

Remove old `.Registration` and `.Endpoints` imports when adopting the root facade
to avoid extension lookup ambiguity. Existing types and method namespaces remain
for source compatibility. `ID1Database`, `ICurrentUser`, `IUserAdministration`,
`IFlarestackEmailSender`, `UserRole` and ownership checks are unchanged.

Deployment now requires an explicit lowercase stage and project-owned
`deployment.json`. The old repository-only preview script delegates to the same
packaged runner; a historical preview hostname is no longer a deployment default.

## Local state and credentials

Local development uses app-owned Alchemy state and Worker registry directories;
it no longer requires or reads a Cloudflare login. The pinned provider patch gives
local binding/D1 materialization an inert account namespace and rejects actual
Cloudflare API credentials in development. Remote resources are unsupported in
this local flow; use an authenticated deployment for them. Cloud deployments keep
the existing encrypted Cloudflare state and authentication path.

Existing local checkouts using the former remote dev-state backend need a one-time
migration before their first start with this version. Startup refuses to create
replacement identities when it finds D1 data without the corresponding state.

Stop Aspire, back up `.alchemy`, and identify the original profile, `dev_<user>`
stage, account ID and `dev:` database ID from the retained provider state. Do not
print the profile's state-store URL/token or dump its signing-secret record. The
command reads the existing cached state endpoint; it never provisions or mutates
cloud resources. First validate, then explicitly import the same target:

```sh
bun run migrate:local-state --profile default --stage dev_YOUR_USER --account-id ACCOUNT_ID --database-id dev:DATABASE_ID
bun run migrate:local-state --profile default --stage dev_YOUR_USER --account-id ACCOUNT_ID --database-id dev:DATABASE_ID --apply
aspire run
```

The command starts a temporary Aspire log receiver if none is configured. It
compares two snapshots, verifies the expected database and signing-secret state,
and writes the encoded records into a new private local directory. It refuses to
overwrite existing local stage state. Keep the original local development stage
name on restart; changing users/stages is a separate migration.

SQLite files, original database identities and signing secrets are preserved. No
remote state is removed. Fresh generated apps already use local state and need
none of these migration steps.
