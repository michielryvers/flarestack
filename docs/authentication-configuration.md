# Authentication configuration

The existing registration remains supported and keeps its immediate configuration
checks and deferred OpenID Connect environment guard:

```csharp
builder.Services.AddFlarestackAuthentication(builder.Configuration);
```

Use the three-argument overload to bind typed options and override them in code:

```csharp
using Flarestack.Authentication.Configuration;
using Flarestack.Authentication.Registration;

builder.Services.AddFlarestackAuthentication(builder.Configuration, options =>
{
    options.ClientId = "todo";
});
```

`AuthenticationOptions.SectionName` is `Flarestack:Authentication`. Binding runs
before the callback. Subsequent `Configure<AuthenticationOptions>` and
`PostConfigure<AuthenticationOptions>` registrations run before validation.
Consumers resolve `IOptions<AuthenticationOptions>.Value`; this is startup
configuration, not live reload. Validation runs when the host starts and also
when options are first consumed. Register this overload with a host providing
`IHostEnvironment`.

| Property | Default | Meaning |
| --- | --- | --- |
| `Authority` | Empty; required | Public absolute HTTPS identity-provider authority. Loopback authorities, including HTTPS loopback, are supported only in Development. HTTP is supported only for loopback Development. |
| `ClientId` | Empty; required | Nonblank OpenID Connect client identifier; also determines the session cookie name. |
| `BackchannelBaseAddress` | `null` | Optional absolute HTTP(S) private route. When absent, account operations use `http://auth.internal` and OIDC requests retain their public authority route. When supplied, exact-authority OIDC requests use the private route too. Empty is invalid. |

The existing loopback cookie and OIDC settings are preserved. The OpenID Connect
post-configuration guard still rejects disabled HTTPS metadata outside
Development, including when callers configure the named OIDC options directly.

`Flarestack:LocalBridgeToken` remains a separate private configuration setting;
it is not exposed on `AuthenticationOptions`. A nonempty token requires the final
backchannel address to be loopback. With a token, leaving the backchannel unset is
invalid because `auth.internal` is not loopback. Late options overrides cannot
bypass this validation. Validation errors identify the setting or policy without
including configured values or credentials.

This overload preserves cookie lifetimes, PKCE, claim mapping, account-client
protocol headers and its ten-second timeout. Live session checks still fail
closed and retain their bounded read retries; administration writes are not
retried. It adds no session timing settings or provider-side configuration.
