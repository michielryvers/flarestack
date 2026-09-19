# Developer experience implementation

Requested scope (local only; no Cloudflare deployment):

- Email: reusable Worker transport, .NET IEmailSender, local inbox linked from
  Aspire, tracing without message bodies/tokens, fast/container E2E.
- Accounts: verification, password recovery, profile/password/session settings,
  auth configuration extension points, account enumeration-safe recovery.
- Administration: typed .NET client, user search/list, role changes, disable/enable,
  revoke sessions, explicit admin bootstrap and audit events. Revocation must reach
  ASP.NET cookies and existing Blazor circuits.
- Setup: configurable ports and derived origin, startup diagnostics, documented
  package/upgrade workflow, template parity.

The local implementation covers these areas; browser and template verification
results are recorded in docs/compatibility.md. Alchemy continues to own
Workers, D1, migrations, containers and email bindings. Aspire owns local lifecycle
and telemetry. Email development uses local capture; live delivery remains untested
until separately authorized domain onboarding and deployment.
