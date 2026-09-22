import { expect, test } from "bun:test";
import { aspireCandidates, nativeToolShimTarget, runAspire } from "../tests/e2e/aspire.ts";

test("Windows Aspire resolution includes Path and PATH native binaries and SDK wrapper metadata", () => {
  const candidates = aspireCandidates({ Path: '"C:\\Program Files\\dotnet\\tools"', PATH: 'D:\\node\\bin;C:\\Users\\runneradmin\\.dotnet\\tools', PATHEXT: '.CMD;.EXE' }, "win32");
  expect(candidates).toContain('C:\\Program Files\\dotnet\\tools\\aspire.exe');
  expect(candidates).toContain('C:\\Users\\runneradmin\\.dotnet\\tools\\aspire.exe');
  expect(candidates.some(path => path.endsWith('.cmd'))).toBe(true);
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


test("native SDK wrapper resolves only its package executable without evaluating script", () => {
  const wrapper = String.raw`C:\Users\runner\.dotnet\tools\aspire.cmd`;
  const target = String.raw`.store\aspire.cli\13.5.3\aspire.cli\13.5.3\tools\net10.0\win-x64\aspire.exe`;
  expect(nativeToolShimTarget(wrapper, `@echo off\r\n"%~dp0${target}" %*\r\n`))
    .toBe(String.raw`C:\Users\runner\.dotnet\tools` + "\\" + target);
  for (const invalid of [
    `@echo off\r\n"%~dp0${target}" %*\r\necho injected\r\n`,
    '@echo off\r\n"%~dp0..\\aspire.exe" %*\r\n',
    '@echo off\r\n"%~dp0.store\\..\\aspire.exe" %*\r\n',
    '@echo off\r\n"%~dp0.store\\%EVIL%\\aspire.exe" %*\r\n',
    '@echo off\r\n"%~dp0.store\\evil&command\\aspire.exe" %*\r\n',
    '@echo off\r\n"%~dp0.store\\aspire.cmd" %*\r\n',
  ]) expect(() => nativeToolShimTarget(wrapper, invalid)).toThrow('supported .NET');
});
