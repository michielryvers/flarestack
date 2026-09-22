import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export function validateReleaseIdentity(version: string, tag: string): void {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || match[4]?.split(".").some(part => /^0\d+$/.test(part)) || /(?:^|[.-])local(?:[.-]|$)/i.test(version)) {
    throw new Error("Registry releases require a non-local SemVer without build metadata, such as 0.1.0-preview.1.");
  }
  if (tag !== `v${version}`) throw new Error("The release tag must exactly match v<version.json version>.");
}

type Manifest = {
  private?: boolean;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  patchedDependencies?: Record<string, unknown>;
};

/** Validate staged content before any package in the coordinated set is published. */
export async function validateRegistryTemplate(directory: string, version: string): Promise<void> {
  const failures: string[] = [];
  let rootManifest: Manifest | undefined;
  async function scan(path: string, relative = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        failures.push(`${name}: symbolic links are not allowed in registry template content.`);
      } else if (entry.isDirectory()) {
        if (["artifacts", "node_modules", ".alchemy", ".packages"].includes(entry.name)) {
          failures.push(`${name}: remove bundled artifacts or local runtime state from the registry template.`);
        } else {
          await scan(target, name);
        }
      } else if (/\.(?:nupkg|snupkg|tgz)$/i.test(entry.name)) {
        failures.push(`${name}: bundled package archives are not allowed.`);
      } else if (entry.name === "package.json") {
        const manifest: Manifest = JSON.parse(await readFile(target, "utf8"));
        if (!relative) rootManifest = manifest;
        if (Object.keys(manifest.patchedDependencies ?? {}).length) {
          failures.push(`${name}: root dependency patches remain required; resolve the upstream fixes before registry publication.`);
        }
        for (const entries of [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]) {
          for (const [dependency, specifier] of Object.entries(entries ?? {})) {
            if (/^(?:file:|link:|workspace:|[./\\]|[A-Za-z]:[\\/])/.test(specifier)) {
              failures.push(`${name}: ${dependency} must resolve from a registry, not a local path.`);
            }
          }
        }
      } else if (entry.name.toLowerCase() === "nuget.config") {
        const text = await readFile(target, "utf8");
        const sources = text.match(/<packageSources>[\s\S]*?<\/packageSources>/i)?.[0] ?? "";
        if ([...sources.matchAll(/<add\b[^>]*\bvalue=["']([^"']+)["']/gi)].some(match => !match[1]!.startsWith("https://"))) {
          failures.push(`${name}: package sources must use HTTPS registries, not a local archive feed.`);
        }
      }
    }
  }
  await scan(directory);
  if (rootManifest?.dependencies?.["@flarestack/alchemy"] !== version) {
    failures.push("package.json: @flarestack/alchemy must have the exact coordinated registry release version.");
  }
  if (failures.length) throw new Error(`Registry publication is blocked:\n${failures.map(failure => `- ${failure}`).join("\n")}`);
}

export function validateRegistryRuntime(runtime: Manifest, repository: Manifest): void {
  if (runtime.private) throw new Error("The npm runtime is still private. Review its registry release readiness before enabling publication.");
  if (runtime.license !== "MIT") throw new Error("The npm runtime must declare the repository's MIT license.");
  if (Object.keys(repository.patchedDependencies ?? {}).length) {
    throw new Error("The repository still requires root dependency patches. Upgrade the affected upstream packages and validate restart/migration before publishing the coordinated registry set.");
  }
}
