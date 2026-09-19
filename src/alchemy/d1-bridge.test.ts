import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import { d1Commands } from "./d1-bridge.ts";
const request = (input: unknown) => new Request("http://d1.internal/v1/commands", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
test("binds hostile text as data and preserves batch ordering", async () => {
 const sqlite = new Database(":memory:"); sqlite.exec("CREATE TABLE todo(id TEXT, owner_id TEXT)");
 const database = {
   prepare(sql: string) {
     return { bind(...parameters: unknown[]) {
       return { async all() {
         const rows = sqlite.prepare(sql).all(...parameters as string[]);
         return { results: rows, meta: { changes: 0 } };
       } };
     } };
   },
   async batch(statements: {all(): unknown}[]) { return Promise.all(statements.map(s => s.all())); }
 } as unknown as D1Database;
 const hostile = "'); DROP TABLE todo; --";
 let response = await d1Commands(request({protocolVersion:1,operation:"execute",sql:"INSERT INTO todo VALUES (?1,?2)",parameters:[hostile,"alice"]}),database);
 expect(response.status).toBe(200);
 response = await d1Commands(request({protocolVersion:1,operation:"batch",commands:[{operation:"query",sql:"SELECT id FROM todo WHERE owner_id=?1",parameters:["bob"]},{operation:"query",sql:"SELECT id FROM todo WHERE owner_id=?1",parameters:["alice"]}]}),database);
 const body = await response.json(); expect(body.results[0].rows).toEqual([]); expect(body.results[1].rows).toEqual([{id:hostile}]); sqlite.close();
});
test.each([null, {}, {protocolVersion:2}, {protocolVersion:1,operation:"batch",commands:[]}, {protocolVersion:1,operation:"execute",sql:"select ?1",parameters:[{}]}])("rejects invalid command before execution %j", async input => {
 const db = {prepare(){throw new Error("must not execute")}} as unknown as D1Database;
 expect((await d1Commands(request(input),db)).status).toBe(400);
});
