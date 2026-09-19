# @flarestack/alchemy

Local preview of Flarestack infrastructure and its Aspire-supervised runtime.
Exports `FlarestackApp`, `createAuthWorker`, `createEmailWorker`, the Worker/container entrypoint,
and local configuration/supervisor/watch entrypoints.

This package ships TypeScript for Bun and Alchemy's Worker bundler. It is not a
Node.js JavaScript distribution. Runtime dependencies are pinned to the tested
compatibility baseline; use matching `0.1.0-local.2` Flarestack NuGet packages.

The Todo sample consumes a packed tarball, not a workspace link. From the repository
root run `bun install --frozen-lockfile`, then `bun run prepare:local`, then `aspire run`.
