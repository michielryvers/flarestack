import { serializeSignedCookie } from "better-call";
import type { Auth } from "better-auth";
import { authOptions, type AuthFeatures } from "./auth-options.ts";

type FullAuth = Auth<ReturnType<typeof authOptions>>;
type AppAuth = Pick<FullAuth, "api"> & { $context: Promise<
  Pick<Awaited<FullAuth["$context"]>, "secret" | "authCookies"> & {
    adapter: { findOne<T>(query: {model: string; where: {field: string; value: string}[]}): Promise<T | null> }
  }> };
// Only reachable through private bindings or the token-protected loopback bridge.
export async function internalAuth(request: Request, auth: AppAuth, features: AuthFeatures = {}) {
  if (request.method !== "POST") return new Response(null, {status:405});
  let input: {userId?: string; sessionId?: string; [key: string]: unknown};
  try { const text = await request.text(); if(text.length > 16_384) return new Response(null,{status:413}); input = JSON.parse(text); }
  catch { return new Response(null, {status:400}); }
  if (!input || typeof input.userId !== "string" || typeof input.sessionId !== "string") return new Response(null, {status:401});
  const context = await auth.$context;
  const session = await context.adapter.findOne<{id:string;userId:string;token:string;expiresAt:Date}>({model:"session",where:[{field:"id",value:input.sessionId}]});
  const user = session && await context.adapter.findOne<{id:string;email:string;name:string;role?:string;banned?:boolean;banExpires?:Date;emailVerified:boolean}>({model:"user",where:[{field:"id",value:input.userId}]});
  if (!session || session.userId !== input.userId || new Date(session.expiresAt).getTime() <= Date.now() || !user ||
      (features.requireEmailVerification && !user.emailVerified) ||
      (user.banned && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now()))) return new Response(null,{status:401});
  const roles = features.adminUserIds?.includes(user.id) ? ["admin"] : (user.role ?? "user").split(",");
  const operation = new URL(request.url).pathname.split("/").pop();
  if (operation === "session") return Response.json({id:user.id,email:user.email,name:user.name,roles});
  if (!roles.includes("admin")) return new Response(null,{status:403});
  // Use Better Auth's own authorization/validation and mutation APIs. Never expose
  // this signed credential or persist it on the .NET side.
  const headers = new Headers({cookie: await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, context.secret)});
  const target = input.targetUserId;
  try {
    if (operation === "users") {
      const offset = typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
      const result = await auth.api.listUsers({headers,query:{limit:50,offset,...(typeof input.search === "string" && input.search ? {filterValue:input.search.trim().toLowerCase().slice(0,254),filterField:"email",filterOperator:"eq"} as const : {})}});
      return Response.json({users:result.users.map(u => ({id:u.id,email:u.email,name:u.name,role: features.adminUserIds?.includes(u.id) ? "admin" : u.role ?? "user",banned:!!u.banned})),total:result.total});
    }
    if (typeof target !== "string" || !target || target === "flarestack-provisioner") return new Response(null,{status:400});
    // Bootstrap admins are managed explicitly in configuration, not this UI.
    if (target === user.id || features.adminUserIds?.includes(target)) return Response.json({error:"protected_admin"},{status:400});
    if (operation === "ban") await auth.api.banUser({headers,body:{userId:target,banReason:"Disabled by administrator"}});
    else if (operation === "unban") await auth.api.unbanUser({headers,body:{userId:target}});
    else if (operation === "revoke") await auth.api.revokeUserSessions({headers,body:{userId:target}});
    else if (operation === "role" && (input.role === "user" || input.role === "admin")) await auth.api.setRole({headers,body:{userId:target,role:input.role}});
    else return new Response(null,{status:400});
    console.log(JSON.stringify({message:"User administration completed",actorId:user.id,targetId:target,operation}));
    return Response.json({success:true});
  } catch { return Response.json({error:"admin_operation_failed"},{status:400}); }
}
