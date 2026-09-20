# Changelog

Changes are recorded under Unreleased until a coordinated package tag is created.
Published entries are immutable; corrections receive a dated note.

## Unreleased

- Add generated-project deployment through `aspire deploy --environment staging`.
- Keep deployment identities and Better Auth secrets stable across updates; require
  separate explicit stage confirmation for destruction. Block implicit removals,
  replacements and generation cleanup during application and backend deployment.
- Add canonical root .NET registrations and a single Aspire setup method while
  retaining compatibility overloads.
- Add focused infrastructure extensions, portable local commands and isolated
  per-application local state/Worker registries.
- Add packed-template Fast/Container and opt-in cloud acceptance, Linux/Windows CI,
  package metadata, matching Source Link symbol packages, MIT licensing and gated
  publication workflows.
- Gate production on explicit acknowledgement of ephemeral Data Protection keys;
  retain the one-container limit.

These changes are under preview validation. See [results](docs/short-path-results.md)
and [migration guidance](docs/api-migration.md) before upgrading. Registry packages
are not yet published.

## 0.1.0-local.2 — local preview

Versioned D1/auth/email bindings, Better Auth account administration, Interactive
Auto Todo template, Aspire orchestration and logs/traces. Distributed as local
packed artifacts with pinned Alchemy compatibility patches.
