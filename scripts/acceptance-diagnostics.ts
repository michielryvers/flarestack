import { redactOutput } from "../src/alchemy/deploy/safety.ts";

// CI artifacts deliberately omit complete telemetry records, attributes and environment maps.
export function diagnosticLine(line: string, environment: Record<string, string | undefined>): string | undefined {
  if (!/error|exception|fail|timeout|timed out|refused|denied|unhealthy|unavailable|not found|could not|cannot|unable|address already in use|process exited|exit code/i.test(line)) return;
  if (/authorization|cookie|password|secret|token|credential|api.?key|client.?assertion|[?&](?:code|state)=/i.test(line)) return "[sensitive diagnostic omitted]";
  return redactOutput(line, environment)
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return "[url]"; } })
    .replace(/[?#][^\s"'<>]+/g, "")
    .replace(/[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .slice(0, 1500);
}

export function diagnosticSummary(output: string, environment: Record<string, string | undefined>) {
  const resources: Array<Record<string, string>> = [];
  const messages: string[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const resource: Record<string, string> = {};
    for (const key of ["name", "resourceName", "state", "healthStatus", "resourceType"]) {
      const item = record[key];
      if (typeof item === "string" && /^[A-Za-z0-9_. -]{1,100}$/.test(item)) resource[key] = item;
    }
    if (resource.state || resource.healthStatus) resources.push(resource);
    for (const [key, item] of Object.entries(record)) {
      if (["body", "message", "formattedMessage"].includes(key) && typeof item === "string") {
        const safe = diagnosticLine(item.split("\n")[0]!, environment);
        if (safe) messages.push(safe);
      }
      // Do not descend into free-form attributes or configuration.
      if (["resources", "logs", "items", "results", "data"].includes(key)) visit(item);
    }
  }
  try { visit(JSON.parse(output)); } catch { messages.push("Diagnostic command did not return JSON."); }
  return { resources: resources.slice(-50), messages: [...new Set(messages)].slice(-60) };
}
