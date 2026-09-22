import { execFile } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { aspireExecutable } from "../tests/e2e/aspire.ts";

const launcher = Bun.which("aspire");
const node = Bun.which("node");
if (!launcher || !node) throw new Error("Aspire and Node must be installed before the executable probe.");
const header = readFileSync(launcher).subarray(0, 2).toString("hex");
console.log(JSON.stringify({ platform: process.platform, bun: Bun.version, launcher, realpath: realpathSync(launcher), basename: basename(launcher), symbolicLink: lstatSync(launcher).isSymbolicLink(), header }));
const executable = aspireExecutable();
console.log(JSON.stringify({ nativeExecutable: executable, realpath: realpathSync(executable), basename: basename(executable) }));
// Run the actual Node runtime, not Bun's node:child_process compatibility layer.
// The child prints version output only; no environment or wrapper content.
const code = `
const { execFile } = require('node:child_process');
console.log(JSON.stringify({ node: process.version, runtime: process.release.name }));
execFile(process.argv[1], ['--version'], { shell: false, timeout: 30000 }, (error, stdout) => {
  if (error) { console.error(JSON.stringify({ failure: error.code ?? 'unknown' })); process.exitCode = 1; }
  else console.log(JSON.stringify({ aspireVersion: stdout.trim() }));
});
`;
const result = await promisify(execFile)(node, ["-e", code, executable], { encoding: "utf8", shell: false, timeout: 45000 });
process.stdout.write(result.stdout);
