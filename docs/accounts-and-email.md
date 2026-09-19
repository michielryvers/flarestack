# Accounts, administration and email

The starter requires email verification for new signups. Alchemy captures local
mail; open the `inbox` endpoint on the `cloudflare` resource in Aspire. Verification
and recovery links stay in the inbox, not in logs or traces. The inbox serves only
loopback requests and never sends real mail. Existing unverified accounts receive
a verification email when they next sign in.

## Account lifecycle

- `/account/sign-in`: signup/login, with a verification email before first login.
- `/account/forgot-password`: generic response for existing and unknown accounts.
- `/account/reset-password`: expiring, single-use recovery link; successful resets
  revoke existing Better Auth sessions.
- `/account/security`: edit display name, change password, view/revoke sessions.
- `/account/settings`: account ID, test email, and administration navigation.

The ASP.NET cookie is revalidated against its Better Auth OIDC `sid` on each
request. Interactive Blazor sessions are checked every 30 seconds. Revoked/banned
sessions fail closed; changed circuit roles require a page reload/sign-in. Existing
cookies without a session ID must sign in again. Applications should use the
registered AuthenticationStateProvider and live AuthorizeView components inside
interactive pages, alongside route authorization policies. Static route checks
alone do not remove a page when circuit authentication changes; never cache
authorization independently for a circuit's lifetime.

## First administrator

1. Sign up, verify the email and sign in.
2. Copy the account ID shown at `/account/settings`.
3. Set `FLARESTACK_ADMIN_USER_IDS` to that ID (comma-separated for multiple IDs),
   or set the AppHost user-secret `Flarestack:AdminUserIds`.
4. Restart the AppHost with that configuration and reload the page.

There is no default administrator or shared password. Bootstrap administrators are
managed in configuration. The admin UI protects them and the acting administrator
from its disable/role/revoke operations. Remove bootstrap IDs from configuration
when retiring them. Subsequent administrators can be promoted in `/admin/users`.
Better Auth's Admin plugin is the underlying authority; its native admin APIs are
also subject to its own administrator authorization rules.

The .NET `IUserAdministration` client supports exact-email lookup/paging, role changes,
disable/enable and revoking sessions. Its private Worker handlers validate the
actor's live session and permissions for every call. They are unavailable through
the public Worker URL. Successful mutations through this client emit audit logs with actor/target IDs
and operation, without cookies or tokens. This is diagnostic auditing, not yet a
separately retained, tamper-resistant audit store.

## Email from application code

Register `AddFlarestackEmail(configuration)` and inject `IFlarestackEmailSender`:

```csharp
await email.SendAsync(new EmailMessage(
    "user@example.com", "Welcome", "Your account is ready."));
```

`createEmailWorker({ main, from })` owns the Alchemy send binding. Pass the Worker
to both `FlarestackApp({ email, ... })` and `createAuthWorker({ email, ... })`.
The .NET client uses the same transport through a private bridge. Plain text and
one recipient are supported in this first version. Sends are not automatically
retried: an ambiguous response must not silently duplicate an email. Delivery
failure fails the operation and appears in traces. Acceptance is not proof of
inbox delivery. Add `Flarestack.Email` to the application's tracing sources.

Live email requires an onboarded sender domain and a separately verified Cloudflare
configuration. The sample sender is local-only. No cloud resources were deployed
or live email sent as part of this implementation.

## Auth extension points

`createAuthWorker` accepts `features.requireEmailVerification`,
additional Better Auth `plugins`, and `databaseHooks`. Core admin/JWT/OAuth plugins
cannot be replaced through the additional-plugin list. Plugin schema changes feed
the existing migration action; hooks do not run for the provisioning service user.
Keep hooks' logs free of passwords, tokens and email bodies. Plugins with additional
infrastructure needs require explicit bindings; the wrapper does not provision
those automatically.

## Checks

Run browser tests, then `bun run verify:telemetry`. The administration test is
opt-in (`FLARESTACK_TEST_ADMIN=1 bunx playwright test admin.spec.ts`) because it
briefly configures a test bootstrap administrator through the process environment
and restarts the AppHost. Its `finally` restores the original environment.

For exact timeout, failure and in-flight semantics, see [the security model](security-model.md).
