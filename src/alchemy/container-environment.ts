/** Cloud bindings carry this record as a secret JSON string; local bindings use a record. */
export function containerEnvironment(value: Record<string, string> | string): Record<string, string> {
  let result: unknown;
  try { result = typeof value === "string" ? JSON.parse(value) : value; }
  catch { throw new Error("Invalid container environment binding."); }
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.values(result).some(item => typeof item !== "string")) throw new Error("Invalid container environment binding.");
  return result as Record<string, string>;
}
