namespace Flarestack.D1;

/// <summary>Runs parameterized queries and commands through the private D1 binding.</summary>
public interface ID1Database
{
    /// <summary>Returns rows mapped to the requested type.</summary>
    Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    /// <summary>Returns one row or the default value, and throws if more than one row is returned.</summary>
    Task<T?> QuerySingleOrDefaultAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    /// <summary>Executes a command and returns the number of affected rows.</summary>
    Task<int> ExecuteAsync(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default);

    /// <summary>Submits an ordered batch of commands to the D1 binding.</summary>
    Task<IReadOnlyList<D1CommandResult>> BatchAsync(
        IReadOnlyList<D1Command> commands,
        CancellationToken cancellationToken = default);
}
