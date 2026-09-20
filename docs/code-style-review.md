# Flarestack code style and setup review

Reviewed 20 September 2026. The current implementation has useful behavioral coverage, but the code often reads like a compressed prototype. The priority is to make configuration, lifetime, and security decisions easy to find and change independently.

The initial review installed guidance and editor conventions without changing runtime code or running services. The proposed Aspire API examples below remain proposals; the checklist records subsequent implementation passes.

## Progress after the initial review

- [x] Complete the Email and D1 readability and file organization passes.
- [x] Split Authentication and Aspire hosting responsibilities into focused files.
- [x] Implement the Email options block for review: configuration binding, caller overrides, and startup validation through a new overload, preserving legacy registration behavior. See [Email configuration](public-api.md#email-configuration).
- [x] Review the Email pattern and extend options binding, caller overrides, and validation to D1 and Authentication. See [D1 configuration](d1-configuration.md) and [Authentication configuration](authentication-configuration.md).
- [x] Introduce typed Aspire resources and explicit manifest application attachment, preserving Fast/Container ownership. See [Aspire hosting](aspire-hosting.md).
- [ ] Integrate tunnel lifecycle and public-origin discovery into hosting.
- [x] Add enforced public API baselines for all four .NET packages. See [API compatibility](api-compatibility.md).
- [x] Verify the new hosting API in Fast and Container modes, plus packed-template clean installation, restart/migration, data preservation, and OTLP checks in Fast mode.
- [ ] Complete TypeScript readability cleanup.

## Reference implementations

| Reference | What to borrow | Application to Flarestack |
| --- | --- | --- |
| [Toolkit Ngrok](https://github.com/CommunityToolkit/Aspire/tree/529d6109784d8ce29218ad1b8e4ee9cc38f50fd6/src/CommunityToolkit.Aspire.Hosting.Ngrok) | Named resource, focused builder extensions, endpoint references, separate resource/annotation types, argument validation | Represent the tunnel and platform explicitly in Aspire rather than coupling them through an artifact file and CLI output parsing. Keep Cloudflare Tunnel as the provider. |
| [Toolkit JavaScript extensions](https://github.com/CommunityToolkit/Aspire/tree/529d6109784d8ce29218ad1b8e4ee9cc38f50fd6/src/CommunityToolkit.Aspire.Hosting.JavaScript.Extensions) | Workspace and application resources, documented composition methods | Separate platform creation from application attachment; keep Alchemy responsible for infrastructure. |
| [Toolkit GoFeatureFlag client](https://github.com/CommunityToolkit/Aspire/tree/529d6109784d8ce29218ad1b8e4ee9cc38f50fd6/src/CommunityToolkit.Aspire.GoFeatureFlag) | Dedicated settings type, configuration binding followed by caller customization, host-builder registration, documented configuration section | Make D1/email/auth configuration discoverable without reading transport code. |
| [Official Aspire JavaScript hosting](https://github.com/microsoft/aspire/blob/main/src/Aspire.Hosting.JavaScript/JavaScriptHostingExtensions.cs) | Existing executable/package-manager integration and documented builder methods | Evaluate native Bun/script support before retaining our own command parser. Preserve process ownership and OTLP collection when replacing anything. |
| [Aaron Stannard's .NET skills](https://github.com/Aaronontheweb/dotnet-skills/tree/e426ed93a9f3215cd21b277fdfa6bfccd3457945) | Focused DI registration, validated options, compatibility discipline, modern C# conventions | Use as review guidance, with repository-specific choices documented in AGENTS.md. |

The Toolkit source snapshot is pinned above. The official Aspire source link tracks main; check our installed version before using an API.

## Specific problems in our code

1. **Several responsibilities share a file and public surface.** `Authentication.cs` combines backchannel rewriting, authentication registration, cookie/session policy, and endpoint mapping. `AccountClient.cs` also contains contracts and circuit revalidation. `Email.cs` contains messages, results, exceptions, registration, and transport. Split by responsibility; retain cohesive small helpers together.
2. **Dense control flow obscures policy.** Statements such as rejecting a principal, signing out, and returning appear inside one-line blocks. Security and failure branches deserve normal blocks and descriptive helper names. This applies to the TypeScript runtime and tests too.
3. **Registration reads configuration ad hoc.** Authentication and email parse string keys directly. Introduce dedicated options, a documented section name, and startup validation. Preserve HTTPS/loopback restrictions and validation timing deliberately; moving validation can change behavior.
4. **The Aspire entry point does too much.** `AddFlarestack` reads JSON, parses package scripts with a regex, validates paths/ports, generates credentials, and wires two executables. Separate configuration loading and validation from resource composition. A typed resource would make extensions discoverable.
5. **The tunnel is an operational workaround.** `scripts/tunnel.ts` parses `aspire describe` for collector credentials, assumes a resource named `cloudflare`, and writes the public origin to an artifact. Move its lifecycle and endpoint publication into the hosting integration. Quick Tunnel URLs appear only after startup, so the design must explicitly sequence origin discovery before auth/app startup.
6. **Internal implementation types become public by default.** Review each type as a supported contract. Record the existing API first; making an existing public type internal is a breaking change even if its name looks internal.
7. **Repository conventions are mostly implicit.** We already have SDK pinning, central package versions, nullable checking, and warnings as errors. Keep these. Add explicit formatting conventions and focused public API documentation instead of replacing the build system.

## Proposed developer-facing shape

```csharp
// Proposal: platform composition and application attachment are separate.
var cloudflare = builder.AddFlarestack("cloudflare", "../infra")
    .WithLocalMode(FlarestackLocalMode.Fast);

builder.AddProject<Projects.Todo_Web>("todo")
    .WithFlarestack(cloudflare);
```

This shape needs a defined Container-mode contract: application attachment must configure the Alchemy-owned container without starting a duplicate local process. A fluent API is only useful if its lifecycle remains correct.

For client packages, retain the existing IServiceCollection entry points and consider convenience overloads on IHostApplicationBuilder. Use focused files such as:

```text
Flarestack.Email/
  EmailMessage.cs
  EmailSendResult.cs
  IFlarestackEmailSender.cs
  FlarestackEmailOptions.cs
  FlarestackEmailServiceCollectionExtensions.cs
  EmailSender.cs
  EmailDeliveryException.cs
```

Use immutable records for messages/results; ordinary mutable options for the .NET configuration binder. Avoid a universal base client or a new result framework just to make packages look alike.

## Refactoring order and acceptance

1. **Readability and file organization.** Start with Email as the small reference package, then D1. Preserve public signatures, namespaces, wire payloads, exception semantics, and telemetry. Separate mechanical formatting from functional changes. Existing tests should still pass.
2. **Options and registration.** Add explicit options and startup validation, with tests for invalid configuration and caller overrides. Keep current overloads compatible. Document any intentionally changed validation timing.
3. **Authentication policy.** Extract cookie validation, backchannel transport, endpoint mapping, and circuit revalidation without changing fail-closed behavior. Run session failure/revocation and cross-user isolation tests.
4. **Aspire resources and local setup.** Introduce typed resources and clear application attachment; consolidate origin configuration and own the tunnel lifecycle. Verify Fast and Container modes, local-only binding credentials, and no duplicate application process.
5. **Public API and template checks.** Add an API baseline, carry conventions into generated projects, and run packed-template acceptance plus OTLP verification. Keep cloud validation as a separate deployment activity.

## Applying the skillset selectively

All 37 skills and supporting files are installed under `.agents/skills`, with the upstream MIT license and a SHA-256 inventory. Claude-specific agents are not installed. Skills become discoverable on the next turn.

Some recommendations are intentionally opinionated: always using struct value objects, universally introducing Result types, and prohibiting Aspire clients are not universal .NET requirements. Do not adopt these as blanket rules. There are also stale cross-skill links and illustrative snippets that require SDK validation. Prefer the proven integration patterns and our tested security/lifecycle contracts.

The initial review added `.editorconfig`, focused AGENTS.md routing, the pinned skill installation, and this document. Subsequent runtime refactors are tracked in the checklist above; it does not imply deployment.
