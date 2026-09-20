import { resolve } from "node:path";
import { validateRegistryRuntime, validateRegistryTemplate, validateReleaseIdentity } from "./release-policy.ts";

const root = resolve(import.meta.dirname, "..");
const { version } = await Bun.file(resolve(root, "version.json")).json();
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : process.argv[2];
if (!tag) throw new Error("Select an immutable v<version> tag, or provide that tag as the first argument for a local check.");
validateReleaseIdentity(version, tag);
if (process.argv.includes("--registry")) {
  await validateRegistryTemplate(resolve(root, "artifacts/template/content"), version);
  validateRegistryRuntime(
    await Bun.file(resolve(root, "src/alchemy/package.json")).json(),
    await Bun.file(resolve(root, "package.json")).json(),
  );
}
console.log(`Release identity verified: ${tag}${process.argv.includes("--registry") ? "; registry content gates passed" : "; candidate build only"}`);
