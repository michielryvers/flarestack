import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("migration CLI exports controlled failure without printing environment secrets", async () => {
  const bodies: string[] = [];
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    bodies.push(new TextDecoder().decode(await request.arrayBuffer()));
    return new Response(new Uint8Array(), { headers: { "content-type": "application/x-protobuf" } });
  } });
  const secret = "migration-cli-private-fixture";
  try {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./migrate-state.ts", import.meta.url)),
      "missing-migration-fixture.json", "--profile", "fixture", "--stage", "dev_fixture", "--account-id", "fixture", "--database-id", "dev:fixture"], {
      env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.port}`, CLOUDFLARE_API_TOKEN: secret },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1);
    expect(stderr).toContain("Legacy migration failed");
    expect(bodies.join("")).toContain("Validating legacy local state");
    expect(stdout + stderr + bodies.join("")).not.toContain(secret);
  } finally { await receiver.stop(true); }
});
