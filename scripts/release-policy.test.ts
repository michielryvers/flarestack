import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRegistryRuntime, validateRegistryTemplate, validateReleaseIdentity } from "./release-policy.ts";

test("release identity requires the exact immutable non-local version tag", () => {
  expect(() => validateReleaseIdentity("0.1.0-preview.1", "v0.1.0-preview.1")).not.toThrow();
  for (const version of ["0.1.0-local.2", "01.1.0", "0.1.0-preview.01", "0.1.0+build", "latest"]) {
    expect(() => validateReleaseIdentity(version, `v${version}`)).toThrow("non-local SemVer");
  }
  expect(() => validateReleaseIdentity("0.1.0", "main")).toThrow("exactly match");
});

test("registry content rejects bundled archives, file dependencies, patches and local NuGet feeds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flarestack-registry-policy-"));
  try {
    await mkdir(join(directory, "artifacts"));
    await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { "@flarestack/alchemy": "file:artifacts/runtime.tgz" }, patchedDependencies: { "alchemy@preview": "patches/required.patch" } }));
    await writeFile(join(directory, "NuGet.Config"), '<configuration><packageSources><add key="local" value="artifacts/nuget" /></packageSources></configuration>');
    await expect(validateRegistryTemplate(directory, "0.1.0")).rejects.toThrow("remove bundled artifacts");
    await rm(join(directory, "artifacts"), { recursive: true });
    await expect(validateRegistryTemplate(directory, "0.1.0")).rejects.toThrow("root dependency patches");
    await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { "@flarestack/alchemy": "file:runtime.tgz" } }));
    await expect(validateRegistryTemplate(directory, "0.1.0")).rejects.toThrow("not a local path");
    await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { "@flarestack/alchemy": "0.1.0" } }));
    await expect(validateRegistryTemplate(directory, "0.1.0")).rejects.toThrow("HTTPS registries");
    await writeFile(join(directory, "NuGet.Config"), '<configuration><packageSources><add key="nuget" value="https://api.nuget.org/v3/index.json" /></packageSources></configuration>');
    await expect(validateRegistryTemplate(directory, "0.1.0")).resolves.toBeUndefined();
    await writeFile(join(directory, "unexpected.nupkg"), "archive");
    await expect(validateRegistryTemplate(directory, "0.1.0")).rejects.toThrow("bundled package archives");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("runtime publication cannot bypass a private manifest or remaining repository patch requirement", () => {
  expect(() => validateRegistryRuntime({ private: true, license: "MIT" }, {})).toThrow("still private");
  expect(() => validateRegistryRuntime({ license: "MIT" }, { patchedDependencies: { alchemy: "required.patch" } })).toThrow("root dependency patches");
  expect(() => validateRegistryRuntime({ license: "MIT" }, {})).not.toThrow();
});
