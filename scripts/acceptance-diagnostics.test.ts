import { expect, test } from "bun:test";
import { diagnosticLine, diagnosticSummary } from "./acceptance-diagnostics.ts";

test("failure artifacts retain compiler/connectivity evidence without sensitive log lines", () => {
  expect(diagnosticLine("error CS0246: Type Widget could not be found", {})).toContain("CS0246");
  expect(diagnosticLine("Connection refused http://127.0.0.1:9202/health?private=value#fragment", {})).toBe("Connection refused http://127.0.0.1:9202/health");
  for (const line of ["error Authorization: Bearer unknown", "error Cookie: sid=unknown", "failed https://app/auth?code=unknown", "error LocalBridgeToken=unknown"]) {
    expect(diagnosticLine(line, {})).toBe("[sensitive diagnostic omitted]");
  }
  expect(diagnosticLine("Connection failed with my-private-value for me@example.test", { API_KEY: "my-private-value" })).toBe("Connection failed with [redacted] for [email]");
  expect(diagnosticLine("Normal request completed", {})).toBeUndefined();
});

test("structured summary only selects diagnostic fields and omits configuration, attributes and endpoints", () => {
  const result=diagnosticSummary(JSON.stringify({resources:[{name:"app",state:"FailedToStart",healthStatus:"Unhealthy",environment:{SECRET:"raw-secret"},endpoints:["https://user:secret@host/?state=private"]}],logs:[{body:"error CS0246: Type Widget not found",attributes:{cookie:"private-cookie"}},{message:"Timeout waiting for app"},{body:"error password=private-password"}]}),{});
  expect(result.resources).toEqual([{name:"app",state:"FailedToStart",healthStatus:"Unhealthy"}]);
  expect(result.messages).toContain("Timeout waiting for app");
  for(const secret of ["raw-secret","private-cookie","private-password","https://","environment","attributes"])expect(JSON.stringify(result)).not.toContain(secret);
  expect(diagnosticSummary("not JSON with raw-secret",{}).messages).toEqual(["Diagnostic command did not return JSON."]);
});
