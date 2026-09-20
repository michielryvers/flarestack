namespace Todo.Client;

// This assembly is downloaded by browsers. Keep bindings, credentials and server services out.
public sealed record TodoItem(string Id, string Title, bool IsComplete, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record CreateTodo(string Title);
public sealed record CompleteTodo(bool IsComplete);
public sealed record BrowserSession(string Id, string Name, string Email, string[] Roles, string RequestToken);
public sealed record BrowserLog(int Level, int EventId);

public interface ITodoService
{
    Task<IReadOnlyList<TodoItem>> ListAsync(CancellationToken ct = default);
    Task<int> AddAsync(string title, CancellationToken ct = default);
    Task<int> SetCompleteAsync(string id, bool complete, CancellationToken ct = default);
    Task<int> DeleteAsync(string id, CancellationToken ct = default);
}

public static class TodoTelemetry
{
    public static readonly System.Diagnostics.ActivitySource Source = new("Todo.Web");
}
