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
