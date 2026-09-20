import { accessSync, constants, statSync } from "node:fs";
import { execFile, type ExecFileOptions } from "node:child_process";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function aspireCandidates(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const path = platform === "win32" ? win32 : posix;
  if (environment.FLARESTACK_ASPIRE_EXECUTABLE) {
    if (!path.isAbsolute(environment.FLARESTACK_ASPIRE_EXECUTABLE)) throw new Error("FLARESTACK_ASPIRE_EXECUTABLE must be an absolute native executable path.");
    return [environment.FLARESTACK_ASPIRE_EXECUTABLE];
  }
  // Bun and Node can inherit both Path and PATH on Windows. Resolve each
  // explicitly; passing an absolute executable avoids Node's choice of key.
  const paths = Object.entries(environment).filter(([key]) => platform === "win32" ? key.toLowerCase() === "path" : key === "PATH");
  const names = platform === "win32" ? ["aspire.exe", "aspire.com"] : ["aspire"];
  return [...new Set(paths.flatMap(([, value]) => (value ?? "").split(path.delimiter).filter(Boolean)
    .flatMap(directory => names.map(name => path.resolve(directory.replace(/^"(.*)"$/, "$1"), name)))))];
}

export function aspireExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of aspireCandidates(environment)) {
    if (process.platform === "win32" && !/\.(exe|com)$/i.test(candidate)) continue;
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  throw new Error("Aspire native executable was not found on PATH. Install the pinned Aspire.Cli tool or set FLARESTACK_ASPIRE_EXECUTABLE to its absolute path.");
}

export function runAspire(args: string[], options: ExecFileOptions = {}) {
  return execute(aspireExecutable(options.env ?? process.env), args, { ...options, encoding: "utf8", shell: false });
}
