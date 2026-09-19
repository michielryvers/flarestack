# Flarestack templates

Local preview template for a .NET 10 Interactive Server Blazor app with Better Auth,
D1 and Aspire observability. Includes the tested local framework packages.

Install this nupkg using `dotnet new install <path>`, then run:

```sh
dotnet new flarestack-blazor -n MyApp
cd MyApp
bun install --frozen-lockfile
aspire run
```

This is a local-development starter. Cloud deployment is not enabled.

When reinstalling a rebuilt local-preview archive, first run
`dotnet new uninstall Flarestack.Templates` to avoid duplicate SDK registrations.
