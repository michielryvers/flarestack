# Infrastructure extension points

One app-owned `infra/alchemy.run.ts` composes the same Alchemy resource graph for
local development and named cloud environments. Alchemy owns Workers, D1,
migrations, secrets and containers; Aspire owns local orchestration and delegates
cloud deployment to the package runner. Keep stack, stage and logical resource
IDs stable when redeploying.

## Container and Edge settings

`FlarestackApp` accepts focused settings alongside its database, auth, optional
email and worker entrypoint:

```ts
export default FlarestackApp({
  // Existing app configuration, resources and workerMain...
  ...appOptions,
  container: {
    ...appOptions.container,
    instanceType: "standard-1",
    maxInstances: 1,
    sleepAfter: "15m",
    environment: { ...appOptions.container.environment, MyApp__Feature: "enabled" },
  },
  bindings: { CACHE: cache, GREETING: "hello" },
  observability: { worker: { enabled: true }, container: { logs: { enabled: true } } },
});
```

`instanceType` uses the installed Alchemy type. Defaults remain `lite`, one
instance, a 30-minute idle timeout and native logs enabled. `sleepAfter` accepts
positive seconds or an SDK duration ending in `s`, `m` or `h`. Other instance
counts fail validation; this release does not promise shared ASP.NET
data-protection keys, multi-instance routing or session affinity. Container
replacement can require fresh sign-in even when the D1 data is preserved.

Additional bindings are attached to Edge. They cannot replace `Database`, `Auth`,
`Email`, `DotNet`, or names beginning with `FLARESTACK_`, `ALCHEMY_`, `OTEL_`,
`LOCAL_` or `CONTAINER_`. Pass secrets as Alchemy/Effect redacted values, never
plaintext committed credentials. The cloud container environment is itself
carried as a secret JSON binding. Local logging still follows the AppHost OTLP
collection path; native cloud observability does not configure a remote OTLP
backend automatically.

## Worker routes and outbound hosts

Function handlers belong in `infra/worker.ts`, where the Worker runtime can load
them. They are not serialized into deployment JSON or passed through the
container environment. Keep exporting the required `DotNet` class name and
`ContainerProxy`:

```ts
import {
  createFlarestackContainer,
  createFlarestackWorker,
  ContainerProxy,
} from "@flarestack/alchemy/worker";

export { ContainerProxy };
export const DotNet = createFlarestackContainer({
  outboundByHost: {
    "api.example.com": request => fetch(request),
  },
});
export default createFlarestackWorker({
  routes: [
    { path: "/api/status", fetch: () => Response.json({ status: "ok" }) },
  ],
});
```

Routes match an exact pathname and receive the request and typed Worker
bindings. Handlers own their method checks, authorization and response policy.
Core health/auth/private-route checks run first; custom routing then runs before
the .NET fallback and receives normalized forwarding headers. Duplicate routes
and reserved auth, account, OIDC callback and `/_flarestack` paths are rejected.
All unrecognized `/_flarestack` requests return 404 at the edge.

Outbound handlers add lowercase hostnames while retaining the core
`auth.internal`, `d1.internal` and `email.internal` handlers. They cannot replace
those hosts. The container factory assigns the SDK registry setter and preserves
the runtime class name `DotNet`; do not replace it with a static field. If only
custom routes are needed, re-export the default `DotNet` class alongside
`ContainerProxy` instead of creating another class.

## Social sign-in

`createAuthWorker` has a narrow `socialProviders` Effect. Resolve credentials
inside that Effect so Alchemy captures them as Worker configuration bindings:

```ts
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const Auth = createAuthWorker({
  // Existing main, database, client, email and features...
  ...authWorkerOptions,
  socialProviders: Effect.gen(function* () {
    const clientId = yield* Config.String("GITHUB_CLIENT_ID");
    const clientSecret = yield* Config.Redacted("GITHUB_CLIENT_SECRET");
    return { github: { clientId, clientSecret: Redacted.value(clientSecret) } };
  }),
});
```

Supply credentials through the selected deployment environment, not source or
`deployment.json`. Alchemy's Config interceptor preserves `Config.Redacted`
through secret bindings; using `Config.String` for a secret loses that property.
Do not read credentials from `process.env` outside the Effect or log resolved
provider configuration. Configure the provider's callback URL for the selected
canonical origin and follow Better Auth's provider-specific setup.

This configures upstream social identity providers only. Flarestack retains the
public issuer, its OAuth client provisioning, authorization-code flow, PKCE,
private account boundary and live-session validation. The `admin`, `jwt` and
`oauth-provider` plugins cannot be replaced through the additional plugin list.
No social-provider credentials or network calls are required by the unit tests;
real provider sign-in remains an environment-specific integration check.
