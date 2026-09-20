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

Existing local checkouts using the former remote dev-state backend require state
migration before their first start with this version. D1 filenames derive from
identifiers in that state: retaining SQLite files alone is insufficient. Do not
delete state or start a fresh local graph over data you want to retain. The
migration procedure is under validation; preserve both remote state and the
application's `.alchemy` directory until it is documented and verified. No remote
dev state or cloud resources are automatically removed.
