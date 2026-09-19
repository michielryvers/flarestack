using Flarestack.D1;
using System.Security.Claims;
namespace Todo.Web;

public sealed record TodoItem(string Id, string OwnerId, string Title, bool IsComplete, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed class TodoRepository(ID1Database database)
{
    private static string Owner(ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true ? user.FindFirstValue("sub") ?? throw new InvalidOperationException("Missing sub claim.") : throw new UnauthorizedAccessException();
    public Task<IReadOnlyList<TodoItem>> ListAsync(ClaimsPrincipal user, CancellationToken ct = default) => database.QueryAsync<TodoItem>("SELECT * FROM todo WHERE owner_id = ?1 ORDER BY created_at DESC", [Owner(user)], ct);
    public Task<int> AddAsync(ClaimsPrincipal user, string title, CancellationToken ct = default)
    {
        title = title.Trim();
        if (title.Length is < 1 or > 200) throw new ArgumentException("Use a title between 1 and 200 characters.");
        var now = DateTimeOffset.UtcNow;
        return database.ExecuteAsync("INSERT INTO todo (id,owner_id,title,is_complete,created_at,updated_at) VALUES (?1,?2,?3,0,?4,?4)", [Guid.NewGuid(), Owner(user), title, now], ct);
    }
    public Task<int> SetCompleteAsync(ClaimsPrincipal user, string id, bool complete, CancellationToken ct = default) => database.ExecuteAsync("UPDATE todo SET is_complete=?1, updated_at=?2 WHERE id=?3 AND owner_id=?4", [complete, DateTimeOffset.UtcNow, id, Owner(user)], ct);
    public Task<int> DeleteAsync(ClaimsPrincipal user, string id, CancellationToken ct = default) => database.ExecuteAsync("DELETE FROM todo WHERE id=?1 AND owner_id=?2", [id, Owner(user)], ct);
}
