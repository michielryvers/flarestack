import {expect,test} from "bun:test";
import {privateRequest} from "./protocol.ts";
import {d1Commands} from "./d1-bridge.ts";
import type {D1Database} from "@cloudflare/workers-types";
test.each([undefined,"1","3"])("protocol %s is rejected before a private operation",async version=>{
  let called=false;
  const request=new Request("http://internal/",{headers:version?{"x-flarestack-protocol":version}:{}});
  const response=await privateRequest(request,async()=>{called=true;return new Response();});
  expect(response.status).toBe(426);expect(called).toBe(false);expect(response.headers.get("x-flarestack-protocol")).toBe("2");
  expect((await response.json()).message).toContain("protocol 2");
});
test("D1 rejects an old client before preparing SQL",async()=>{
  const response=await d1Commands(new Request("http://d1.internal/v1/commands",{method:"POST",body:JSON.stringify({protocolVersion:1,sql:"DELETE FROM todo"})}),{prepare(){throw new Error("Executed incompatible request");}} as unknown as D1Database);
  expect(response.status).toBe(426);
});
