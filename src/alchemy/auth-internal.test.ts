import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "./auth-options.ts";
import { internalAuth } from "./auth-internal.ts";

test("internal administration checks live sessions, roles and revocation", async () => {
  const database = new Database(":memory:");
  const features = { adminUserIds: ["bootstrap"] };
  const options = {...authOptions("http://localhost:8787",{clientId:"test",clientName:"test",resourceId:"test"},false,features), database, secret:crypto.randomUUID()+crypto.randomUUID()};
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options); const ctx = await auth.$context;
  try {
    const admin = await ctx.internalAdapter.createUser({id:"bootstrap",name:"Admin",email:"admin@example.test",emailVerified:true},{method:"admin"});
    const user = await ctx.internalAdapter.createUser({name:"User",email:"user@example.test",emailVerified:true},{method:"admin"});
    const a = await ctx.internalAdapter.createSession(admin.id,false); const u = await ctx.internalAdapter.createSession(user.id,false);
    const call = (op:string, actor = {userId:admin.id,sessionId:a.id}, body = {}) => internalAuth(new Request(`http://auth.internal/_flarestack/internal/${op}`,{method:"POST",headers:{"x-flarestack-protocol":"2"},body:JSON.stringify({...actor,...body})}),auth,features);
    expect((await call("users",{userId:user.id,sessionId:u.id})).status).toBe(403);
    expect((await call("users",{userId:admin.id,sessionId:u.id})).status).toBe(401);
    expect((await call("users")).status).toBe(200);
    expect((await (await call("users",undefined,{search:"user@example.test"})).json()).users).toHaveLength(1);
    expect((await call("role",undefined,{targetUserId:user.id,role:"admin"})).status).toBe(200);
    expect((await (await call("session",{userId:user.id,sessionId:u.id})).json()).roles).toEqual(["admin"]);
    expect((await call("ban",undefined,{targetUserId:admin.id})).status).toBe(400);
    expect((await call("ban",undefined,{targetUserId:user.id})).status).toBe(200);
    expect((await call("session",{userId:user.id,sessionId:u.id})).status).toBe(401);
    expect((await call("unban",undefined,{targetUserId:user.id})).status).toBe(200);
    const u2 = await ctx.internalAdapter.createSession(user.id,false);
    expect((await call("revoke",undefined,{targetUserId:user.id})).status).toBe(200);
    expect((await call("session",{userId:user.id,sessionId:u2.id})).status).toBe(401);
    const expired = await ctx.internalAdapter.createSession(user.id,false);
    await ctx.internalAdapter.updateSession(expired.token,{expiresAt:new Date(0)});
    expect((await call("session",{userId:user.id,sessionId:expired.id})).status).toBe(401);
  } finally {database.close();}
});
