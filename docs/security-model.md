# Session and authorization model

The application is a .NET 10 Blazor Web App. Todo pages use Interactive Auto;
account and administration pages use server rendering.
Better Auth is the session authority; the ASP.NET cookie is an encrypted local
representation, not a second independent session authority.

## Session consistency

- OIDC `sub` identifies the user; `sid` identifies the Better Auth session row.
  Both must match. The private Auth handler checks expiry, ban state and required
  email verification against current database records.
- Cookie validation runs on every request that reaches ASP.NET authentication
  middleware with an application cookie. This includes app pages, API calls,
  Blazor negotiation and circuit connection requests. Public Worker `/auth/*`
  requests bypass ASP.NET. Public static assets short-circuit the middleware:
  downloading CSS/JS/WASM does not validate or clear a cookie. Protected requests
  continue to validate the live session before granting access.
- Existing WebSocket circuit events are not new ASP.NET HTTP requests. The
  authentication-state provider revalidates every 30 seconds. Validation times out
  after 10 seconds, so an unavailable authority can take approximately 40 seconds
  plus scheduling/transport delay to invalidate an idle circuit. Use live
  `AuthorizeView` components; static route authorization alone is insufficient.
- `ICurrentUser` performs a fresh validation for every operation. The generated
  Todo repository resolves it before each D1 operation; administration resolves it
  and enforces `Flarestack.Administration`. The private Auth handler independently
  checks the administrator's live session and role before every mutation.
- Session lookups retry transport errors and HTTP 5xx responses at most twice,
  with 100/200 ms delays inside one 10-second budget. A successful live response
  is still required. Expired/revoked responses, malformed data and explicit
  protocol mismatches are not retried. Mutations are never retried by this policy.
- There is no validation-result cache. Fast mode uses authenticated loopback HTTP
  to the private bridge; Container mode uses HTTP intercepted by the private
  `auth.internal` service binding. These calls do not use the public auth URL.
- Network failure, timeout, invalid response, incompatible protocol, missing,
  expired or revoked session fail closed. Cookie validation clears the cookie;
  operation validation throws before D1/admin work. A subsequent OIDC attempt
  during an outage can show the generic sign-in-unavailable response.
- Cookie expiry is eight hours with sliding expiration. A cookie can remain in
  the browser after the underlying session expires or is revoked; it grants no
  independent access. Current name/email/roles refresh during cookie validation.
  Changed circuit roles invalidate circuit authentication until reload/sign-in.
- Revocation does not retroactively cancel an operation already authorized and in
  flight. A D1 write may finish after revocation if its validation happened first.
  There is no transaction spanning session validation and application D1 writes.

| Better Auth state | ASP.NET cookie | Protected HTTP request | Existing circuit / next guarded operation |
| --- | --- | --- | --- |
| Valid | Valid | Continue; refresh claims | Continue |
| Expired or revoked | Valid | Clear cookie and challenge | Revalidation invalidates circuit; next operation rejects immediately |
| Disabled user | Valid | Clear cookie and challenge | Same as revocation |
| Auth unavailable / incompatible | Valid | Fail closed; clear cookie | Fail closed on validation; no new guarded mutation |
| Valid | Missing | OIDC challenge | No independent circuit sign-in |
| Role changed | Valid | Refresh role, apply policy | Invalidate stale circuit; guarded operation uses live role |

## WebAssembly sessions

The Todo browser client obtains only public identity claims and a CSRF request token
from `/api/session`; the HttpOnly application cookie remains the credential. Every
API request performs the same live cookie validation as server-rendered requests.
API failures return 401/403, not OIDC redirects. Mutations validate antiforgery tokens
and derive ownership from `ICurrentUser`, never browser-provided identity.

Browser UI revalidation runs every 30 seconds with a 10-second HTTP timeout and
fails closed; task API 401/403 responses invalidate it immediately. Displayed roles
are never an authorization boundary. A different account detected in another tab
requires a reload before the old workspace can be reused. Already-authorized writes can finish after
revocation, as in Server mode. See [Interactive Auto](interactive-auto.md).

## Data ownership and private transport

D1 has no application-level row ownership enforcement in this framework. Raw
`ID1Database` calls are privileged: **never accept an owner ID from a request as
proof of ownership**. Resolve it from `ICurrentUser`; include `owner_id` in reads,
updates and deletes. Generated projects include cross-user isolation tests. The
framework does not rewrite SQL or provide RLS.

SQL parameters are bound separately. SQL statement tracing is opt-in and excludes
bound values, but literals in SQL are still visible: do not inline secrets.
Private endpoints enforce protocol compatibility before executing operations.
Fast-mode bridge credentials are restricted to loopback and are not auth cookies.
Do not expose the bridge or mount the internal handlers on a public route.

## Administration and email

Set `FLARESTACK_ADMIN_USER_IDS` for the stage (or the AppHost user-secret
`Flarestack:AdminUserIds`). No personal bootstrap IDs belong in source. Restart
locally to apply changes. The wrapper protects the acting/bootstrap administrator;
Better Auth's native Admin APIs additionally remain governed by its own policies.

Email returns **acceptance**, not delivery confirmation. The local inbox contains
verification/recovery secrets and is loopback-only. Bodies, cookies, authorization
headers, OAuth state and recovery tokens must stay out of telemetry. Audit logs
are diagnostic; retention and tamper-resistant auditing are not implemented.
