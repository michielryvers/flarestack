# Public API baselines

The four source packages use `Microsoft.CodeAnalysis.PublicApiAnalyzers` 5.6.0:
`Flarestack.D1`, `Flarestack.Email`, `Flarestack.Authentication`, and
`Aspire.Hosting.Flarestack`. The analyzer is a private build dependency with its
version in `Directory.Packages.props`; consumers do not acquire it as a package
dependency.

Each project keeps `PublicAPI.Shipped.txt` and `PublicAPI.Unshipped.txt` beside its
project file. Both enable nullable signature tracking. **The initial baseline is
the current preview API, not a claim of compatibility with an earlier release.**
All current entries are in Unshipped; Shipped intentionally has no API entries.
This records the current Authentication and Hosting subfolder namespaces and the
new options and hosting registration surfaces.

Ordinary source builds enforce the baselines. The existing repository-wide
`TreatWarningsAsErrors` turns undeclared public API additions (`RS0016`) and
missing or changed declared APIs (`RS0017`) into build failures. No build target
updates or approves these files. The analyzer package automatically includes the
two files as analyzer inputs.

```sh
mise exec -- dotnet build src/Flarestack.D1
mise exec -- dotnet build src/Flarestack.Email
mise exec -- dotnet build src/Flarestack.Authentication
mise exec -- dotnet build src/Aspire.Hosting.Flarestack
```

These checks run when the package projects are built, including package builds.
Tests that consume an already packed binary do not rebuild its source or rerun
its analyzer: run these builds when reviewing library changes. Do not disable
analyzers or weaken diagnostics to accept an API change.

## Deliberate changes

Review the API design before accepting a baseline diff. Prefer a new overload or
member while preserving existing signatures. Renaming a namespace, changing an
optional parameter, or removing an overload can break consumers even when local
call sites compile.

For an intentional addition, use the analyzer's IDE code fix or its SDK CLI code
fix, limited to the affected project:

```sh
mise exec -- dotnet format analyzers src/Flarestack.Email/Flarestack.Email.csproj \
  --diagnostics RS0016 --no-restore
```

This is a manual maintenance command, not part of verification. Inspect the
resulting `PublicAPI.Unshipped.txt` diff and commit the reviewed API change with
its implementation. Do not automatically approve a failing build. An intentional
preview removal needs an explicit review and removal of its Unshipped entry;
preserve previously released signatures unless the release policy explicitly
allows a breaking change. At a release, deliberately move that release's accepted
Unshipped entries into Shipped while retaining the nullable header. For released
removals, follow the analyzer's `*REMOVED*` convention and the project's breaking
release policy; never rewrite release history to conceal the removal.

The baseline was generated using the official analyzer code fix. Verification
also temporarily added a public method to EmailOptions and changed its existing
public Timeout property to internal: builds failed with RS0016 and RS0017
respectively. The original source was restored and the build passed afterward.

## Scope and limits

The files track the analyzer's representation of public signatures, including
nullability, parameter names/defaults, extension methods, constants, and record
members represented by the analyzer. They are review gates, not a complete proof
of binary, source, or behavioral compatibility. Changes to implementations,
validation timing, configuration defaults, protocol payloads, authorization,
reflection/serialization contracts, or metadata not represented by this analyzer
still require design review and focused tests. Adding an overload can introduce
source ambiguity even after its baseline entry is approved.

For a future supported release, retain real released packages and add package
compatibility validation against them. These preview text baselines must not be
presented as validation against a previously published package.

See the [official analyzer usage guide](https://github.com/dotnet/roslyn/blob/main/src/RoslynAnalyzers/PublicApiAnalyzers/PublicApiAnalyzers.Help.md)
and [diagnostic reference](https://github.com/dotnet/roslyn/blob/main/src/RoslynAnalyzers/PublicApiAnalyzers/Microsoft.CodeAnalysis.PublicApiAnalyzers.md).
