import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
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
  const names = platform === "win32" ? ["aspire.exe", "aspire.com", "aspire.cmd"] : ["aspire"];
  return [...new Set(paths.flatMap(([, value]) => (value ?? "").split(path.delimiter).filter(Boolean)
    .flatMap(directory => names.map(name => path.resolve(directory.replace(/^"(.*)"$/, "$1"), name)))))];
}

// SDK 10.0.401 ShellShimRepository emits this exact wrapper for native tools.
// https://github.com/dotnet/sdk/blob/v10.0.401/src/Cli/dotnet/ShellShim/ShellShimRepository.cs
// Read its target as metadata; never execute .cmd or interpret shell syntax.
export function nativeToolShimTarget(wrapper: string, content: string): string {
  const match = /^@echo off\r?\n"%~dp0([^"\r\n%]+)" %\*\r?\n$/.exec(content);
  const relative = match?.[1];
  if (!relative || !/^\.store[\\/]/i.test(relative) || /[&|<>^!]/.test(relative)
    || relative.split(/[\\/]/).some(part => part === ".." || part === ".")
    || !/[\\/]aspire\.exe$/i.test(relative)) {
    throw new Error("Aspire .cmd launcher does not match the supported .NET native-tool wrapper.");
  }
  return win32.resolve(win32.dirname(wrapper), relative);
}

export function aspireExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of aspireCandidates(environment)) {
    if (process.platform === "win32" && !/\.(exe|com|cmd)$/i.test(candidate)) continue;
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform === "win32" && candidate.toLowerCase().endsWith(".cmd")) {
        const target = nativeToolShimTarget(candidate, readFileSync(candidate, "utf8"));
        const realTarget = realpathSync(target);
        const store = realpathSync(win32.join(win32.dirname(candidate), ".store"));
        const relative = win32.relative(store, realTarget);
        if (relative.startsWith("..") || win32.isAbsolute(relative) || !statSync(realTarget).isFile()) {
          throw new Error("Aspire native-tool target is outside its package store.");
        }
        const executable = readFileSync(realTarget);
        const peOffset = executable.length >= 64 ? executable.readUInt32LE(60) : -1;
        if (executable.subarray(0, 2).toString() !== "MZ" || peOffset < 0 || peOffset > executable.length - 4
          || executable.readUInt32LE(peOffset) !== 0x00004550) {
          throw new Error("Aspire native-tool target is not a Windows executable.");
        }
        return realTarget;
      }
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
