# Flarestack local preview

These .NET 10 packages are built for local evaluation with the Todo sample.

- `Flarestack.D1`: parameterized queries and batches through the internal D1 bridge.
- `Flarestack.Authentication`: ASP.NET cookie/OIDC integration and the browser sign-in asset.
- `Aspire.Hosting.Flarestack`: Alchemy process supervision and fast/container local modes.

Use matching `0.1.0-local.1` versions alongside `@flarestack/alchemy`. The compatibility
baseline is .NET SDK 10.0.401, Aspire 13.5.3, Bun 1.4.2 and Alchemy 2.0.0-beta.79.
Packages have not been published. See the repository README for bootstrap and verification.
