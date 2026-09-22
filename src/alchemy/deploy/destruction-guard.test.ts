import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Resource, type ResourceLike } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { make } from "alchemy/Stack";
import { Stage } from "alchemy/Stage";
import { InMemoryService, State, type ResourceState, type ReplacedResourceState } from "alchemy/State";
import * as Plan from "alchemy/Plan";
import { apply } from "alchemy/Apply";
import { layer } from "alchemy/Alchemist";
import { assertDeploymentSafetySupport } from "./safety.ts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";

const ResourceType = Resource<ResourceLike<"Flarestack.GuardFixture", { value: string }, { value: string }, never, undefined>>("Flarestack.GuardFixture");

function fixture() {
  const counters = { reconcile: 0, delete: 0 };
  const rows: Record<string, ResourceState> = {};
  let replacement = false;
  let lateCleanup = false;
  let preexistingCleanup = false;
  const state = InMemoryService({ fixture: { staging: rows } }).pipe(Effect.map(service => ({
    ...service,
    getReplacedResources: (request: Parameters<typeof service.getReplacedResources>[0]) => preexistingCleanup || (lateCleanup && counters.reconcile > 1)
      ? Effect.succeed([{ ...rows.Database, status: "replaced", old: rows.Database, deleteFirst: false } as ReplacedResourceState])
      : service.getReplacedResources(request),
  })));
  const providers = Provider.succeed(ResourceType, {
    read: () => Effect.succeed(undefined),
    diff: ({ olds, news }) => Effect.succeed({ action: replacement ? "replace" as const : JSON.stringify(olds) === JSON.stringify(news) ? "noop" as const : "update" as const }),
    reconcile: ({ news }) => Effect.sync(() => { counters.reconcile++; return news; }),
    delete: () => Effect.sync(() => { counters.delete++; }),
  });
  const run = (values: Record<string, string>, destroy = false) => Effect.runPromise(Effect.gen(function* () {
    const stack = yield* make({ name: "fixture", providers, state: Layer.succeed(State, state) })(Effect.gen(function* () {
      for (const [name, value] of Object.entries(values)) yield* ResourceType(name, { value });
      return {};
    }));
    yield* Effect.gen(function* () {
      const plan = yield* (destroy ? Plan.destroy(stack) : Plan.make(stack));
      yield* apply(plan);
    }).pipe(Effect.provideContext(stack.services));
  }).pipe(Effect.provideService(Stage, "staging"), Effect.provideService(State, state), Effect.provideService(AuthProviders, {}), Effect.provide(layer()), Effect.scoped));
  return { counters, rows, run, replace: () => { replacement = true; }, lateCleanup: () => { lateCleanup = true; }, preexistingCleanup: () => { preexistingCleanup = true; } };
}

async function guarded(body: () => Promise<void>) {
  const previous = process.env.FLARESTACK_NON_DESTRUCTIVE_APPLY;
  process.env.FLARESTACK_NON_DESTRUCTIVE_APPLY = "1";
  try { await body(); }
  finally {
    if (previous === undefined) delete process.env.FLARESTACK_NON_DESTRUCTIVE_APPLY;
    else process.env.FLARESTACK_NON_DESTRUCTIVE_APPLY = previous;
  }
}

test("pinned guard permits real Plan/Apply create, noop and update", () => guarded(async () => {
  expect((await import(Bun.resolveSync("alchemy/Apply", process.cwd()))).flarestackNonDestructiveApplyVersion).toBe(1);
  const f = fixture();
  await f.run({ Database: "one" });
  await f.run({ Database: "one" });
  await f.run({ Database: "two" });
  expect(f.counters).toEqual({ reconcile: 2, delete: 0 });
}));

test.each(["destroy", "retain"] as const)("removed resource with %s policy fails before any provider mutation", policy => guarded(async () => {
  const f = fixture();
  await f.run({ Database: "one" });
  f.rows.Database!.removalPolicy = policy;
  await expect(f.run({ NewResource: "two" })).rejects.toThrow("Deployment blocked");
  expect(f.counters).toEqual({ reconcile: 1, delete: 0 });
  expect(f.rows.Database).toBeDefined();
}));

test("replacement and pending replacement generations fail before provider mutation", () => guarded(async () => {
  const f = fixture();
  await f.run({ Database: "one" });
  f.replace();
  await expect(f.run({ Database: "two" })).rejects.toThrow("Deployment blocked");
  expect(f.counters).toEqual({ reconcile: 1, delete: 0 });
  const g = fixture();
  await g.run({ Database: "one" });
  const old = g.rows.Database!;
  g.rows.Database = { ...old, status: "replaced", old, deleteFirst: false } as ReplacedResourceState;
  await expect(g.run({ Database: "two" })).rejects.toThrow("Deployment blocked");
  expect(g.counters).toEqual({ reconcile: 1, delete: 0 });
  g.rows.Database = { ...old, status: "updating", old: g.rows.Database } as ResourceState;
  await expect(g.run({ Database: "two" })).rejects.toThrow("Deployment blocked");
  expect(g.counters).toEqual({ reconcile: 1, delete: 0 });
}));

test("cleanup appearing after initial plan is rejected at the garbage collection boundary", () => guarded(async () => {
  const f = fixture();
  await f.run({ Database: "one" });
  f.lateCleanup();
  await expect(f.run({ Database: "two" })).rejects.toThrow("Deployment blocked");
  expect(f.counters).toEqual({ reconcile: 2, delete: 0 });
  expect(f.rows.Database).toBeDefined();
}));

test("explicit destroy stays blocked with guard and works only when runner removes policy", () => guarded(async () => {
  const f = fixture();
  await f.run({ Database: "one" });
  await expect(f.run({}, true)).rejects.toThrow("Deployment blocked");
  expect(f.counters.delete).toBe(0);
  delete process.env.FLARESTACK_NON_DESTRUCTIVE_APPLY;
  await f.run({}, true);
  expect(f.counters.delete).toBe(1);
  expect(f.rows.Database).toBeUndefined();
}));

test("missing or unsupported engine patch fails closed", () => {
  for (const marker of [undefined, null, 0, 2, "1"]) expect(() => assertDeploymentSafetySupport(marker)).toThrow("safety patch is missing");
  expect(() => assertDeploymentSafetySupport(1)).not.toThrow();
});

test("persisted cleanup outside the current plan is blocked before any new provider mutation", () => guarded(async () => {
  const f = fixture();
  await f.run({ Database: "one" });
  f.preexistingCleanup();
  await expect(f.run({ Database: "one", Extra: "two" })).rejects.toThrow("Deployment blocked");
  expect(f.counters).toEqual({ reconcile: 1, delete: 0 });
}));
