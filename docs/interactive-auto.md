# Interactive Auto

The Todo workspace uses .NET 10 Blazor Interactive Auto. A first visit runs the
interactive component on the server while the WebAssembly runtime downloads.
Subsequent visits can run it in the browser. An existing component does not switch
runtimes mid-session. Account and administration pages remain Interactive Server.
The ASP.NET backend and Cloudflare container are still required.

## Application structure

- `Todo.Client`: the Todo component, public DTOs, `ITodoService`, browser HTTP
  implementation, browser session state and safe browser log forwarding. Everything
  here is downloadable. Never reference private bindings or put secrets here.
- `Todo.Web`: server rendering, protected HTTP endpoints and `TodoRepository`.
  Server mode injects the repository as `ITodoService`; WebAssembly injects
  `HttpTodoService`. Both use the same UI and server-side ownership predicates.
- `Todo.ServiceDefaults`: server OTLP logs and traces to Aspire.

`AddInteractiveWebAssemblyComponents`, `AddInteractiveWebAssemblyRenderMode` and
additional-assembly registration enable the client routes. The Todo component uses
`@rendermode InteractiveAuto`; routes and account/admin components stay in the server
project. Generated projects include the same structure with the chosen app name.

## HTTP contract

These are sample application endpoints, not public Flarestack binding endpoints.
They require the application HttpOnly session cookie and return 401/403 instead of
redirecting API clients through OIDC. Data responses use `Cache-Control: no-store`.

| Endpoint | Result |
| --- | --- |
| `GET /api/session` | Current ID, name, email, roles and antiforgery request token; no Better Auth session ID |
| `GET /api/todos` | Current user's tasks |
| `POST /api/todos` | `{ "title": "..." }`, 1–200 trimmed characters; 204 |
| `PATCH /api/todos/{id}` | `{ "isComplete": true }`; 204 or 404 |
| `DELETE /api/todos/{id}` | 204 or 404 |
| `POST /api/client-logs` | Up to 32 severity/event-ID pairs, exported through server OTLP |

All writes require the antiforgery cookie and `RequestVerificationToken` header.
Unknown and other users' task IDs both return 404. There is no owner-ID input.
The repository resolves `ICurrentUser` before every database operation, including
calls from server-rendered components. Browser state never authorizes a write.

Public CSS, JavaScript and WebAssembly assets use `MapStaticAssets().ShortCircuit()`.
They contain no private data and do not perform session lookups. This avoids a burst
of auth/D1 operations for the many parallel WASM downloads; pages and APIs still
validate their cookies. Keep private content out of static assets.

## Sessions and telemetry

The browser loads current identity from `/api/session` and refreshes every 30
seconds (HTTP timeout: 10 seconds). Failures clear the browser's authenticated UI;
a task API 401/403 invalidates it immediately. The server independently validates
the cookie on every API request. Server session reads have bounded transient retries
inside the same 10-second validation budget; they never fall back to cached identity. No bearer tokens or binding credentials are
stored in browser storage. Switching accounts in another tab invalidates the old
workspace until reload, preventing reuse of its cached tasks. Logout remains a full-page antiforgery-protected POST.

WebAssembly task requests go through the same Worker → ASP.NET → D1/auth trace
chain as other HTTP requests. Server-mode events retain the `Todo change` span.
Browser logs forward only severity and event ID, excluding formatted messages,
exception text and claims. The server exports them to Aspire under `Todo.Client`;
this bounded, best-effort buffer is not an audit log. Event 1000 means WebAssembly
started. Browser CPU/render spans and offline operation are not implemented.

## Verification

`bun run test:e2e` exercises a fresh browser's Server mode, revisits until cached
WebAssembly is selected, performs CRUD through both paths, and checks CSRF, owner
isolation and logout. `bun run verify:telemetry` checks the resulting OTLP evidence.
Use the same commands with `FLARESTACK_TEST_MODE=Container` in Container mode.

See Microsoft's [render-mode documentation](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes?view=aspnetcore-10.0).
