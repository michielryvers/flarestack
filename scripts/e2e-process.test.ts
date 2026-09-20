import { expect, test } from "bun:test";
import { aspireCandidates, runAspire } from "../tests/e2e/aspire.ts";

test("Windows Aspire resolution includes Path and PATH native binaries without shell shims", () => {
  const candidates = aspireCandidates({ Path: '"C:\\Program Files\\dotnet\\tools"', PATH: 'D:\\node\\bin;C:\\Users\\runneradmin\\.dotnet\\tools', PATHEXT: '.CMD;.EXE' }, "win32");
  expect(candidates).toContain('C:\\Program Files\\dotnet\\tools\\aspire.exe');
  expect(candidates).toContain('C:\\Users\\runneradmin\\.dotnet\\tools\\aspire.exe');
  expect(candidates.some(path => path.endsWith('.cmd'))).toBe(false);
  expect(aspireCandidates({ PATH: '/usr/local/bin:/usr/bin' }, 'linux')).toEqual(['/usr/local/bin/aspire', '/usr/bin/aspire']);
  expect(() => aspireCandidates({ FLARESTACK_ASPIRE_EXECUTABLE: 'aspire.cmd' }, 'win32')).toThrow('absolute native');
});

test("E2E process calls preserve literal arguments and environment without a shell", async () => {
  const literal = 'spaces & semicolon; $(echo unsafe)';
  const { stdout } = await runAspire(['-e', 'console.log(JSON.stringify([process.argv[1], process.env.FLARESTACK_TEST_ARGUMENT]))', literal], {
    env: { ...process.env, FLARESTACK_ASPIRE_EXECUTABLE: process.execPath, FLARESTACK_TEST_ARGUMENT: literal }, maxBuffer: 1024,
  });
  expect(JSON.parse(stdout)).toEqual([literal, literal]);
});
