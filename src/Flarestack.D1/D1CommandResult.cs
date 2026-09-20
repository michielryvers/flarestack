using System.Text.Json;

namespace Flarestack.D1;

/// <summary>The affected row count and optional query rows for a batch command.</summary>
public sealed record D1CommandResult(int RowsAffected, IReadOnlyList<JsonElement>? Rows = null);
