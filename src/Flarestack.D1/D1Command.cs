namespace Flarestack.D1;

/// <summary>A SQL statement and its bound parameters within a D1 batch.</summary>
public sealed record D1Command(
    string Sql,
    IReadOnlyList<object?> Parameters,
    D1CommandKind Kind = D1CommandKind.Execute);
